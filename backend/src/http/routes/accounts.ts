import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, transactions } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';

const decimal = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 fraction digits');

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be ISO date YYYY-MM-DD');

const isoCurrency = z
  .string()
  .regex(/^[A-Z]{3}$/, 'must be ISO 4217 3-letter code');

// lockYears: 0..99. null means "no lock" — never blocked. 0 is *not* the same
// as null (0 = unlocked immediately on opening; null = no lock rule at all).
const lockYears = z.number().int().min(0).max(99).nullable();

const CreateBody = z.object({
  name: z.string().trim().min(1).max(128),
  type: z.string().trim().min(1).max(64),
  currency: isoCurrency.default('EUR'),
  openingBalance: decimal.default('0'),
  openingDate: isoDate,
  lockYears: lockYears.optional(),
});

const UpdateBody = z
  .object({
    name: z.string().trim().min(1).max(128),
    type: z.string().trim().min(1).max(64),
    currency: isoCurrency,
    openingBalance: decimal,
    openingDate: isoDate,
    lockYears: lockYears,
  })
  .partial();

const IdParam = z.object({ id: z.coerce.number().int().positive() });

const MergeBody = z.object({
  targetId: z.number().int().positive(),
});

function parseId(req: FastifyRequest, reply: FastifyReply): number | null {
  const r = IdParam.safeParse(req.params);
  if (!r.success) {
    reply.code(400).send({ error: 'invalid id' });
    return null;
  }
  return r.data.id;
}

export async function accountsRoutes(app: FastifyInstance): Promise<void> {
  // Every route in this plugin requires auth.
  app.addHook('preHandler', app.requireAuth);

  // List accounts with computed current balance + counts. We use raw SQL here
  // (same pattern as reports.ts) because Drizzle's column-reference
  // interpolation across a correlated subquery turned out to silently miscorrelate
  // — the inner WHERE never matched, and the counts came back as 0 despite
  // matching transactions existing in the DB. Explicit aliases (`a`, `t`)
  // guarantee the correlation lines up.
  app.get('/api/accounts', async (req) => {
    const uid = userId(req);
    // "available" vs "blocked" decomposition:
    //   opening_balance is available iff account.lock_years is null OR
    //     opening_date + lock_years years <= today.
    //   each transaction is available iff:
    //     - t.lock_years IS NOT NULL AND t.date + t.lock_years years <= today, OR
    //     - t.lock_years IS NULL AND (a.lock_years IS NULL OR a.opening_date + a.lock_years years <= today).
    //   blocked_balance = current_balance - available_balance.
    const result = await db.execute<{
      id: number;
      name: string;
      type: string;
      currency: string;
      opening_balance: string;
      opening_date: string;
      display_order: number;
      created_at: Date;
      lock_years: number | null;
      current_balance: string;
      available_balance: string;
      transaction_count: number;
      counted_transaction_count: number;
    }>(sql`
      SELECT
        a.id,
        a.name,
        a.type,
        a.currency,
        a.opening_balance::text                                AS opening_balance,
        to_char(a.opening_date, 'YYYY-MM-DD')                  AS opening_date,
        a.display_order,
        a.created_at,
        a.lock_years                                           AS lock_years,
        (
          a.opening_balance + COALESCE(
            (SELECT SUM(t.amount) FROM transactions t
              WHERE t.account_id = a.id AND t.date >= a.opening_date),
            0
          )
        )::text                                                AS current_balance,
        (
          (CASE
            WHEN a.lock_years IS NULL
              OR (a.opening_date + (INTERVAL '1 year' * a.lock_years))::date <= CURRENT_DATE
            THEN a.opening_balance
            ELSE 0
          END)
          + COALESCE(
              (SELECT SUM(t.amount) FROM transactions t
                WHERE t.account_id = a.id AND t.date >= a.opening_date
                  AND (
                    CASE
                      WHEN t.lock_years IS NOT NULL
                        THEN (t.date + (INTERVAL '1 year' * t.lock_years))::date <= CURRENT_DATE
                      WHEN a.lock_years IS NOT NULL
                        THEN (a.opening_date + (INTERVAL '1 year' * a.lock_years))::date <= CURRENT_DATE
                      ELSE TRUE
                    END
                  )),
              0)
        )::text                                                AS available_balance,
        (SELECT COUNT(*)::int FROM transactions t
          WHERE t.account_id = a.id)                           AS transaction_count,
        (SELECT COUNT(*)::int FROM transactions t
          WHERE t.account_id = a.id AND t.date >= a.opening_date)
                                                               AS counted_transaction_count
      FROM accounts a
      WHERE a.user_id = ${uid}
      ORDER BY a.display_order ASC, a.name ASC
    `);

    const accounts = result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      currency: r.currency,
      openingBalance: r.opening_balance,
      openingDate: r.opening_date,
      displayOrder: r.display_order,
      createdAt: r.created_at,
      lockYears: r.lock_years,
      currentBalance: r.current_balance,
      availableBalance: r.available_balance,
      transactionCount: r.transaction_count,
      countedTransactionCount: r.counted_transaction_count,
    }));

    return { accounts };
  });

  // Bulk reorder: PUT /api/accounts/order { ids: [3, 1, 2] } assigns
  // display_order = index to each id in the array. Wrapped in a transaction
  // so a partial failure leaves the previous order intact.
  const ReorderBody = z.object({
    ids: z.array(z.number().int().positive()).min(1).max(200),
  });
  app.put('/api/accounts/order', async (req, reply) => {
    const parsed = ReorderBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const { ids } = parsed.data;
    if (new Set(ids).size !== ids.length) {
      return reply.code(400).send({ error: 'duplicate ids in order list' });
    }
    const uid = userId(req);
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx
          .update(accounts)
          .set({ displayOrder: i })
          .where(and(eq(accounts.id, ids[i]!), eq(accounts.userId, uid)));
      }
    });
    return { ok: true };
  });

  app.post('/api/accounts', async (req, reply) => {
    const uid = userId(req);
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    try {
      const [created] = await db.insert(accounts).values({ ...parsed.data, userId: uid }).returning();
      return reply.code(201).send({ account: created });
    } catch (err) {
      // unique_violation on (user_id, name)
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({ error: 'account name already exists' });
      }
      throw err;
    }
  });

  app.get('/api/accounts/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const [row] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, uid)));
    if (!row) return reply.code(404).send({ error: 'not found' });
    return { account: row };
  });

  app.put('/api/accounts/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'no fields to update' });
    }
    try {
      const [updated] = await db
        .update(accounts)
        .set(parsed.data)
        .where(and(eq(accounts.id, id), eq(accounts.userId, uid)))
        .returning();
      if (!updated) return reply.code(404).send({ error: 'not found' });
      return { account: updated };
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({ error: 'account name already exists' });
      }
      throw err;
    }
  });

  app.delete('/api/accounts/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    try {
      const [deleted] = await db
        .delete(accounts)
        .where(and(eq(accounts.id, id), eq(accounts.userId, uid)))
        .returning({ id: accounts.id });
      if (!deleted) return reply.code(404).send({ error: 'not found' });
      return { ok: true };
    } catch (err) {
      // foreign_key_violation — transactions.account_id has ON DELETE RESTRICT
      if (isPgError(err) && err.code === '23503') {
        return reply
          .code(409)
          .send({ error: 'account has transactions; remove them first' });
      }
      throw err;
    }
  });

  app.post('/api/accounts/:sourceId/merge', async (req, reply) => {
    const uid = userId(req);

    const sourceParse = z.object({ sourceId: z.coerce.number().int().positive() })
      .safeParse(req.params);
    if (!sourceParse.success) {
      return reply.code(400).send({ error: 'invalid source id' });
    }
    const sourceId = sourceParse.data.sourceId;

    const bodyParse = MergeBody.safeParse(req.body);
    if (!bodyParse.success) {
      return reply.code(400).send({ error: 'invalid input', issues: bodyParse.error.issues });
    }
    const targetId = bodyParse.data.targetId;

    if (sourceId === targetId) {
      return reply.code(400).send({ error: 'source and target must differ' });
    }

    const rows = await db
      .select()
      .from(accounts)
      .where(and(inArray(accounts.id, [sourceId, targetId]), eq(accounts.userId, uid)));
    const source = rows.find((r) => r.id === sourceId);
    const target = rows.find((r) => r.id === targetId);
    if (!source) return reply.code(404).send({ error: 'source not found' });
    if (!target) return reply.code(404).send({ error: 'target not found' });

    if (source.currency !== target.currency) {
      return reply.code(400).send({
        error: 'currency mismatch',
        sourceCurrency: source.currency,
        targetCurrency: target.currency,
      });
    }

    const merged = await db.transaction(async (tx) => {
      // Step A — promote source's account-level lock_years to per-row for
      // transactions where the per-row value is null. Preserves lock intent
      // across the move.
      if (source.lockYears != null) {
        await tx.execute(sql`
          UPDATE transactions
             SET lock_years = ${source.lockYears}
           WHERE account_id = ${sourceId}
             AND lock_years IS NULL
        `);
      }

      // Step B — delete source transactions that collide with an existing
      // target transaction. Target's copy wins.
      //
      // We cannot compare dedup_keys directly: computeDedupKey hashes
      // account_id into its material, so two logically-identical rows on
      // different accounts get different keys. Instead, match on content:
      // FITID (bank-provided globally-unique id) if both sides have one,
      // otherwise on (date, amount, normalized_label).
      const dedupDropped = await tx.execute<{ id: number }>(sql`
        DELETE FROM transactions src
         WHERE src.account_id = ${sourceId}
           AND EXISTS (
             SELECT 1 FROM transactions tgt
              WHERE tgt.account_id = ${targetId}
                AND (
                  (src.fitid IS NOT NULL AND tgt.fitid IS NOT NULL AND src.fitid = tgt.fitid)
                  OR (
                    src.date = tgt.date
                    AND src.amount = tgt.amount
                    AND src.normalized_label = tgt.normalized_label
                  )
                )
           )
        RETURNING src.id
      `);
      const dedupCollisionsDropped = dedupDropped.rows.length;

      // Step C — move every remaining source transaction onto target.
      const moved = await tx.execute<{ id: number }>(sql`
        UPDATE transactions
           SET account_id = ${targetId}
         WHERE account_id = ${sourceId}
        RETURNING id
      `);
      const transactionsMoved = moved.rows.length;

      // Step D — collapse transfer groups now entirely on target.
      const doomed = await tx.execute<{ transfer_group_id: string }>(sql`
        SELECT transfer_group_id
          FROM transactions
         WHERE transfer_group_id IS NOT NULL
         GROUP BY transfer_group_id
        HAVING COUNT(*) FILTER (WHERE account_id <> ${targetId}) = 0
           AND COUNT(*) > 0
      `);
      const doomedIds = doomed.rows.map((r) => r.transfer_group_id);
      if (doomedIds.length > 0) {
        // Use the typed builder with inArray — Drizzle's `sql\`... ANY(${js
        // array}::uuid[])\`` template passes the array through as a bare
        // string, which Postgres rejects with "malformed array literal".
        await tx
          .update(transactions)
          .set({ transferGroupId: null })
          .where(inArray(transactions.transferGroupId, doomedIds));
      }
      const transferGroupsCollapsed = doomedIds.length;

      // Step E — repoint side tables (delete colliders first, then UPDATE).

      // account_filename_patterns — no unique on account_id alone.
      const patternsRes = await tx.execute<{ id: number }>(sql`
        UPDATE account_filename_patterns
           SET account_id = ${targetId}
         WHERE account_id = ${sourceId}
        RETURNING id
      `);
      const patternsMoved = patternsRes.rows.length;

      // balance_checkpoints — unique (account_id, checkpoint_date).
      await tx.execute(sql`
        DELETE FROM balance_checkpoints
         WHERE account_id = ${sourceId}
           AND checkpoint_date IN (
             SELECT checkpoint_date FROM balance_checkpoints WHERE account_id = ${targetId}
           )
      `);
      const checkpointsRes = await tx.execute<{ id: number }>(sql`
        UPDATE balance_checkpoints
           SET account_id = ${targetId}
         WHERE account_id = ${sourceId}
        RETURNING id
      `);
      const checkpointsMoved = checkpointsRes.rows.length;

      // category_budgets — scoped uniq on (user_id, category_id, period, account_id).
      await tx.execute(sql`
        DELETE FROM category_budgets
         WHERE account_id = ${sourceId}
           AND (user_id, category_id, period) IN (
             SELECT user_id, category_id, period
               FROM category_budgets
              WHERE account_id = ${targetId}
           )
      `);
      const budgetsRes = await tx.execute<{ id: number }>(sql`
        UPDATE category_budgets
           SET account_id = ${targetId}
         WHERE account_id = ${sourceId}
        RETURNING id
      `);
      const budgetsMoved = budgetsRes.rows.length;

      // file_imports — no unique on account_id alone.
      const importsRes = await tx.execute<{ id: number }>(sql`
        UPDATE file_imports
           SET account_id = ${targetId}
         WHERE account_id = ${sourceId}
        RETURNING id
      `);
      const importsMoved = importsRes.rows.length;

      // pdf_statement_templates — unique (fingerprint, account_id).
      await tx.execute(sql`
        DELETE FROM pdf_statement_templates
         WHERE account_id = ${sourceId}
           AND fingerprint IN (
             SELECT fingerprint FROM pdf_statement_templates WHERE account_id = ${targetId}
           )
      `);
      const templatesRes = await tx.execute<{ id: number }>(sql`
        UPDATE pdf_statement_templates
           SET account_id = ${targetId}
         WHERE account_id = ${sourceId}
        RETURNING id
      `);
      const templatesMoved = templatesRes.rows.length;

      // pdf_import_drafts — transient; sweeper purges within 24h anyway.
      const draftsRes = await tx.execute<{ id: number }>(sql`
        UPDATE pdf_import_drafts
           SET account_id = ${targetId}
         WHERE account_id = ${sourceId}
        RETURNING id
      `);
      const draftsMoved = draftsRes.rows.length;

      // Step F — bump target's opening_balance by source's.
      const openingBalanceAdded = source.openingBalance;
      await tx.execute(sql`
        UPDATE accounts
           SET opening_balance = opening_balance + ${openingBalanceAdded}::numeric
         WHERE id = ${targetId}
      `);

      // Step G — delete the source account.
      await tx.execute(sql`DELETE FROM accounts WHERE id = ${sourceId}`);

      return {
        transactionsMoved,
        dedupCollisionsDropped,
        transferGroupsCollapsed,
        patternsMoved,
        checkpointsMoved,
        budgetsMoved,
        importsMoved,
        templatesMoved,
        draftsMoved,
        openingBalanceAdded,
      };
    });

    app.log.info(
      { sourceId, targetId, uid, counts: merged },
      'account merge complete',
    );
    return { ok: true, merged };
  });
}

function isPgError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string';
}
