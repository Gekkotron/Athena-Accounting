import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { accounts, transactions } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { MergeBody, SourceIdParam } from './schemas.js';

export function registerMerge(app: FastifyInstance): void {
  app.post('/api/accounts/:sourceId/merge', async (req, reply) => {
    const uid = userId(req);

    const sourceParse = SourceIdParam.safeParse(req.params);
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

    // Merging accounts with different opening_date would silently drop
    // transactions dated before the target's opening_date from every
    // balance/timeseries query (they filter `t.date >= a.opening_date`).
    // Harmonizing here is fragile — target may already have transactions
    // dated before source.opening_date whose sum is baked into its own
    // opening_balance — so refuse the merge and let the user align dates.
    if (source.openingDate !== target.openingDate) {
      return reply.code(409).send({
        error: 'opening date mismatch',
        sourceOpeningDate: source.openingDate,
        targetOpeningDate: target.openingDate,
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
