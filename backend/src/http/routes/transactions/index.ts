import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { transactions } from '../../../db/schema.js';
import { normalizeLabel } from '../../../domain/imports/normalize.js';
import { computeDedupKey } from '../../../domain/imports/dedup.js';
import { categorizeOne, loadRuleEngine } from '../../../domain/rules/recategorize.js';
import { userId } from '../../plugins/auth.js';
import { CreateBody, ListQuery, PatchBody } from './schemas.js';
import { isPgError, parseId } from './helpers.js';
import { registerDuplicateRoutes } from './duplicates.js';

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

  app.get('/api/transactions', async (req, reply) => {
    const uid = userId(req);
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const q = parsed.data;

    const where: SQL[] = [eq(transactions.userId, uid)];
    if (q.accountId) where.push(eq(transactions.accountId, q.accountId));
    if (q.categoryId) where.push(eq(transactions.categoryId, q.categoryId));
    if (q.sourceFileId) where.push(eq(transactions.sourceFileId, q.sourceFileId));
    if (q.fromDate) where.push(gte(transactions.date, q.fromDate));
    if (q.toDate) where.push(lte(transactions.date, q.toDate));
    if (q.minAmount) where.push(gte(transactions.amount, q.minAmount));
    if (q.maxAmount) where.push(lte(transactions.amount, q.maxAmount));
    if (q.amount) {
      // Exact match on the absolute value: matches both the credit and the
      // debit, which is what the user usually means by "find 338€".
      const abs = Math.abs(Number(q.amount)).toFixed(2);
      const neg = (-Math.abs(Number(q.amount))).toFixed(2);
      const cond = or(eq(transactions.amount, abs), eq(transactions.amount, neg));
      if (cond) where.push(cond);
    }
    if (!q.includeTransfers) where.push(isNull(transactions.transferGroupId));

    if (q.search) {
      // Accent + case-insensitive substring match against the normalized label.
      where.push(
        sql`immutable_unaccent(lower(${transactions.normalizedLabel})) LIKE '%' || immutable_unaccent(lower(${q.search})) || '%'`,
      );
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

    return {
      transactions: rows,
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
    return { transaction: row };
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
