import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { transactions, transactionSplits, accounts } from '../../../db/schema.js';
import { normalizeLabel } from '../../../domain/imports/normalize.js';
import { computeDedupKey } from '../../../domain/imports/dedup.js';
import { categorizeOne, loadRuleEngine } from '../../../domain/rules/recategorize.js';
import { userId } from '../../plugins/auth.js';
import { CreateBody, ListQuery, PatchBody } from './schemas.js';
import { isPgError, parseId } from './helpers.js';
import { registerDuplicateRoutes } from './duplicates.js';
import { registerSplitsRoutes } from './splits.js';
import { computeRunningBalances } from './running-balance.js';

/**
 * Attach `splits: TransactionSplit[]` to each row. Batched single query on
 * `transaction_splits.transaction_id IN (...)`; empty array when the parent
 * has no splits.
 *
 * INVARIANT: callers MUST filter `rows` by the caller's `userId` before
 * hydration. This helper does NOT re-filter by user_id — it trusts that the
 * incoming `rows` are already scoped to the caller. Adding a new caller that
 * passes unscoped rows would leak splits across users.
 */
async function hydrateSplits<T extends { id: number }>(rows: T[]): Promise<Array<T & { splits: Array<{
  id: number; transactionId: number; categoryId: number | null; amount: string; memo: string | null;
}> }>> {
  if (rows.length === 0) return rows.map((r) => ({ ...r, splits: [] }));
  const ids = rows.map((r) => r.id);
  const splits = await db
    .select()
    .from(transactionSplits)
    .where(inArray(transactionSplits.transactionId, ids));
  const byTx = new Map<number, Array<typeof splits[number]>>();
  for (const s of splits) {
    const arr = byTx.get(s.transactionId) ?? [];
    arr.push(s);
    byTx.set(s.transactionId, arr);
  }
  return rows.map((r) => ({
    ...r,
    splits: (byTx.get(r.id) ?? []).map((s) => ({
      id: s.id,
      transactionId: s.transactionId,
      categoryId: s.categoryId,
      amount: s.amount,
      memo: s.memo,
    })),
  }));
}

export async function transactionsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  // Manual transaction creation. Same dedup discipline as the importer — the
  // UNIQUE(account_id, dedup_key) constraint rejects exact duplicates at the
  // DB level, which we translate to a clean 409.
  app.post('/api/transactions', async (req, reply) => {
    const uid = userId(req);
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const v = parsed.data;
    const amount = Number(v.amount).toFixed(2);
    const normalized = normalizeLabel(v.rawLabel);
    const dedupKey = computeDedupKey({
      accountId: v.accountId,
      date: v.date,
      amount,
      normalizedLabel: normalized,
      fitid: null,
    });

    try {
      const [inserted] = await db
        .insert(transactions)
        .values({
          userId: uid,
          accountId: v.accountId,
          date: v.date,
          amount,
          rawLabel: v.rawLabel,
          normalizedLabel: normalized,
          memo: null,
          notes: v.notes && v.notes.trim() ? v.notes : null,
          fitid: null,
          dedupKey,
          categoryId: v.categoryId ?? null,
          categorySource: v.categoryId ? 'manual' : 'auto',
          sourceFileId: null,
          lockYears: v.lockYears ?? null,
        })
        .returning();
      if (!inserted) {
        return reply.code(500).send({ error: 'failed to insert transaction' });
      }

      // If the user didn't pick a category, run the same rule engine the
      // importer runs — keeps semantics consistent across creation paths.
      if (!v.categoryId) {
        const { compiled, defaultId } = await loadRuleEngine(userId(req));
        await categorizeOne(
          compiled,
          defaultId,
          inserted.id,
          Number(amount),
          normalized,
        );
      }

      const [final] = await db.select().from(transactions).where(eq(transactions.id, inserted.id));
      return reply.code(201).send({ transaction: final ?? inserted });
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({
          error: 'une transaction identique existe déjà pour ce compte (même date, montant et libellé)',
        });
      }
      if (isPgError(err) && err.code === '23503') {
        return reply.code(400).send({ error: 'compte ou catégorie inconnu' });
      }
      throw err;
    }
  });

  registerDuplicateRoutes(app);
  registerSplitsRoutes(app);

  app.get('/api/transactions', async (req, reply) => {
    const uid = userId(req);
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const q = parsed.data;

    const where: SQL[] = [eq(transactions.userId, uid)];
    if (q.accountId) where.push(eq(transactions.accountId, q.accountId));
    if (q.categoryId) {
      // Match plain-category transactions OR transactions with any split
      // targeting the wanted category. Keeps the "Livres" filter honest
      // when a Livres split lives on an Amazon transaction whose own
      // category_id points elsewhere (or is null).
      where.push(sql`(
        ${transactions.categoryId} = ${q.categoryId}
        OR EXISTS (
          SELECT 1 FROM ${transactionSplits} s
           WHERE s.transaction_id = ${transactions.id}
             AND s.category_id = ${q.categoryId}
        )
      )`);
    }
    if (q.sourceFileId) where.push(eq(transactions.sourceFileId, q.sourceFileId));
    if (q.fromDate) where.push(gte(transactions.date, q.fromDate));
    if (q.toDate) where.push(lte(transactions.date, q.toDate));
    if (q.minAmount) where.push(gte(transactions.amount, q.minAmount));
    if (q.maxAmount) where.push(lte(transactions.amount, q.maxAmount));
    if (q.amount) {
      // Sign-agnostic match — both the credit and the debit — which is what
      // the user usually means by "find 338€". A bare integer ("19") widens
      // to the whole euro: 19.00–19.99, so it also finds 19.72. Typing the
      // cents explicitly ("19.72", "722.90") keeps an exact match, which is
      // what reconciliation against a known écart needs.
      const n = Math.abs(Number(q.amount));
      if (q.amount.includes('.')) {
        const abs = n.toFixed(2);
        const neg = (-n).toFixed(2);
        const cond = or(eq(transactions.amount, abs), eq(transactions.amount, neg));
        if (cond) where.push(cond);
      } else {
        // n is an integer here (regex forbids a fractional part without a dot).
        const lo = `${n}.00`;
        const hi = `${n}.99`;
        const cond = or(
          and(gte(transactions.amount, lo), lte(transactions.amount, hi)),
          and(gte(transactions.amount, `-${n}.99`), lte(transactions.amount, `-${n}.00`)),
        );
        if (cond) where.push(cond);
      }
    }
    if (!q.includeTransfers) where.push(isNull(transactions.transferGroupId));

    if (q.search) {
      // Substring match across every user-facing text field, accent- and
      // case-insensitive. Four seq-scan LIKE branches — acceptable at
      // homelab scale (~<10k rows). If perf hurts, promote to a generated
      // column + GIN trigram index (see TODO.md).
      const needle = sql`immutable_unaccent(lower(${q.search}))`;
      where.push(sql`(
        immutable_unaccent(lower(${transactions.rawLabel})) LIKE '%' || ${needle} || '%'
        OR immutable_unaccent(lower(${transactions.normalizedLabel})) LIKE '%' || ${needle} || '%'
        OR immutable_unaccent(lower(coalesce(${transactions.memo}, ''))) LIKE '%' || ${needle} || '%'
        OR immutable_unaccent(lower(coalesce(${transactions.notes}, ''))) LIKE '%' || ${needle} || '%'
      )`);
    }

    const whereExpr = where.length > 0 ? and(...where) : undefined;
    const dir = q.order === 'asc' ? asc : desc;
    const orderCol =
      q.sort === 'amount' ? transactions.amount :
      q.sort === 'label'  ? transactions.normalizedLabel :
                            transactions.date;

    const rows = await db
      .select()
      .from(transactions)
      .where(whereExpr)
      .orderBy(dir(orderCol), desc(transactions.id))
      .limit(q.limit)
      .offset(q.offset);

    const countRows = await db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(transactions)
      .where(whereExpr);
    const total = countRows[0]?.total ?? 0;

    // Running balance: only computed when the view is scoped to one account
    // (the only case the UI can display it). We accumulate over the account's
    // FULL chronological history — including transfer rows the list hides by
    // default — so pagination, sort order, and row filters never distort it.
    let balanceById: Map<number, string> | null = null;
    if (q.accountId) {
      const [acct] = await db
        .select({ openingBalance: accounts.openingBalance })
        .from(accounts)
        .where(and(eq(accounts.id, q.accountId), eq(accounts.userId, uid)));
      if (acct) {
        const history = await db
          .select({ id: transactions.id, amount: transactions.amount })
          .from(transactions)
          .where(and(eq(transactions.userId, uid), eq(transactions.accountId, q.accountId)))
          .orderBy(asc(transactions.date), asc(transactions.id));
        balanceById = computeRunningBalances(history, acct.openingBalance);
      }
    }

    const withBalance = balanceById
      ? rows.map((r) => ({ ...r, runningBalance: balanceById!.get(r.id) }))
      : rows;

    const hydrated = await hydrateSplits(withBalance);
    return {
      transactions: hydrated,
      pagination: { total, limit: q.limit, offset: q.offset },
    };
  });

  app.get('/api/transactions/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const [row] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, uid)));
    if (!row) return reply.code(404).send({ error: 'not found' });
    const [hydrated] = await hydrateSplits([row]);
    return { transaction: hydrated };
  });

  // Inline category edit from the UI. Any explicit categoryId set via this
  // endpoint flips category_source to 'manual' — this is the flag the
  // retroactive recategorizer respects when `preserveManual: true`.
  app.patch('/api/transactions/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    // Build the actual SET clause from the fields present in the patch.
    // category_source flips to 'manual' only when the categoryId itself is
    // touched — updating just a note shouldn't change provenance.
    // dedup_key stays static so re-imports of the source file still find the
    // row (edits change content, not identity).
    const updates: {
      accountId?: number;
      date?: string;
      amount?: string;
      rawLabel?: string;
      normalizedLabel?: string;
      categoryId?: number | null;
      categorySource?: 'manual';
      notes?: string | null;
      lockYears?: number | null;
    } = {};
    if ('accountId' in parsed.data && parsed.data.accountId !== undefined) {
      updates.accountId = parsed.data.accountId;
    }
    if ('date' in parsed.data && parsed.data.date !== undefined) {
      updates.date = parsed.data.date;
    }
    if ('amount' in parsed.data && parsed.data.amount !== undefined) {
      updates.amount = Number(parsed.data.amount).toFixed(2);
    }
    if ('rawLabel' in parsed.data && parsed.data.rawLabel !== undefined) {
      updates.rawLabel = parsed.data.rawLabel;
      updates.normalizedLabel = normalizeLabel(parsed.data.rawLabel);
    }
    if ('categoryId' in parsed.data) {
      updates.categoryId = parsed.data.categoryId ?? null;
      updates.categorySource = 'manual';
    }
    if ('notes' in parsed.data) {
      const raw = parsed.data.notes;
      updates.notes = raw && raw.trim() ? raw : null;
    }
    if ('lockYears' in parsed.data) {
      updates.lockYears = parsed.data.lockYears ?? null;
    }
    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'no fields to update' });
    }

    try {
      const [updated] = await db
        .update(transactions)
        .set(updates)
        .where(and(eq(transactions.id, id), eq(transactions.userId, uid)))
        .returning();
      if (!updated) return reply.code(404).send({ error: 'not found' });
      return { transaction: updated };
    } catch (err) {
      if (isPgError(err) && err.code === '23503') {
        return reply.code(400).send({ error: 'compte ou catégorie inconnu' });
      }
      // Pinned to migration 0014's `transactions_amount_lock_when_split_trg`.
      // If a future migration adds another CHECK/trigger on `transactions`
      // that raises SQLSTATE 23514, that trigger's error should not inherit
      // this specific French message — match on the trigger's own text.
      if (isPgError(err)
          && err.code === '23514'
          && (err as { message?: string }).message?.includes('cannot change transaction amount')) {
        return reply.code(409).send({
          error: "supprimez d'abord la ventilation avant de modifier le montant",
        });
      }
      throw err;
    }
  });

  // Batch-delete a set of transactions by id. Applies the same transfer-leg
  // unlink guard as the single-DELETE handler: any mirror leg still owned by
  // the user gets its transfer_group_id set to null so aggregates don't
  // silently hide it. Wrapped in one DB transaction so a partial failure
  // rolls back cleanly.
  app.post('/api/transactions/delete-bulk', async (req, reply) => {
    const uid = userId(req);
    const parsed = z.object({
      ids: z.array(z.number().int().positive()).min(1).max(500),
    }).safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'ids must be a non-empty array of positive integers (max 500)' });
    }
    const ids = parsed.data.ids;

    const result = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: transactions.id, transferGroupId: transactions.transferGroupId })
        .from(transactions)
        .where(and(eq(transactions.userId, uid), inArray(transactions.id, ids)));

      // Collect transfer-group ids that need mirror unlinking. Only unlink
      // the OTHER leg of the group (not the row we're about to delete). If
      // both legs are in the delete set, the group vanishes entirely — the
      // unlink is a no-op but harmless.
      const groupIds = new Set<string>();
      for (const row of existing) {
        if (row.transferGroupId) groupIds.add(row.transferGroupId);
      }
      if (groupIds.size > 0) {
        await tx
          .update(transactions)
          .set({ transferGroupId: null })
          .where(and(
            eq(transactions.userId, uid),
            inArray(transactions.transferGroupId, Array.from(groupIds)),
          ));
      }

      const deleted = await tx
        .delete(transactions)
        .where(and(eq(transactions.userId, uid), inArray(transactions.id, ids)))
        .returning({ id: transactions.id });
      return { deleted: deleted.length };
    });

    return result;
  });

  // Delete a single transaction. If the row is half of a linked internal
  // transfer pair, also unlink the mirror leg so it doesn't silently become
  // an "invisible" orphan (transfer_group_id IS NULL filters in the
  // aggregates would otherwise hide it).
  app.delete('/api/transactions/:id', async (req, reply) => {
    const id = parseId(req, reply);
    if (id === null) return;

    const uid = userId(req);
    const [existing] = await db
      .select({ id: transactions.id, transferGroupId: transactions.transferGroupId })
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, uid)));
    if (!existing) return reply.code(404).send({ error: 'not found' });

    if (existing.transferGroupId) {
      await db
        .update(transactions)
        .set({ transferGroupId: null })
        .where(and(eq(transactions.transferGroupId, existing.transferGroupId), eq(transactions.userId, uid)));
    }

    await db.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, uid)));
    return { ok: true };
  });
}
