import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, gte, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { transactions } from '../../db/schema.js';
import { normalizeLabel } from '../../domain/imports/normalize.js';
import { computeDedupKey } from '../../domain/imports/dedup.js';
import { categorizeOne, loadRuleEngine } from '../../domain/rules/recategorize.js';
import { userId } from '../plugins/auth.js';

const ListQuery = z.object({
  accountId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  minAmount: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
  maxAmount: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
  // Match exact amount, sign-agnostic — a search for "338" hits both -338 and
  // +338 transactions. The frontend auto-detects numeric input and routes here
  // instead of the text search.
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
  search: z.string().trim().max(128).optional(),
  includeTransfers: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .default(false),
  sort: z.enum(['date', 'amount', 'label']).default('date'),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// All fields optional — the PATCH applies whichever ones are present, so the
// frontend can update any subset without sending the others.
const PatchBody = z.object({
  accountId: z.number().int().positive().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
  rawLabel: z.string().trim().min(1).max(512).optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// Body for manual creation. raw_label is required; the server derives the
// normalized_label + dedup_key. categoryId is optional — when omitted the rule
// engine fires the same way it does at import time.
const CreateBody = z.object({
  accountId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
  rawLabel: z.string().trim().min(1).max(512),
  categoryId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

function isPgError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string';
}

const IdParam = z.object({ id: z.coerce.number().int().positive() });

function parseId(req: FastifyRequest, reply: FastifyReply): number | null {
  const r = IdParam.safeParse(req.params);
  if (!r.success) {
    reply.code(400).send({ error: 'invalid id' });
    return null;
  }
  return r.data.id;
}

export async function transactionsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  // Manual transaction creation. Same dedup discipline as the importer — the
  // UNIQUE(account_id, dedup_key) constraint rejects exact duplicates at the
  // DB level, which we translate to a clean 409.
  app.post('/api/transactions', async (req, reply) => {
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
        })
        .returning();
      if (!inserted) {
        return reply.code(500).send({ error: 'failed to insert transaction' });
      }

      // If the user didn't pick a category, run the same rule engine the
      // importer runs — keeps semantics consistent across creation paths.
      if (!v.categoryId) {
        const { compiled, defaultId } = await loadRuleEngine();
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

  // Soft-dedup detection: find transactions that share (account, date, amount)
  // but have a different dedup_key — i.e. labels that differ enough to evade
  // the strict UNIQUE constraint but match enough on identity to be plausible
  // duplicates worth a human glance. Used by the Imports page to surface these
  // after every import.
  app.get('/api/transactions/duplicates', async (req, reply) => {
    const uid = userId(req);
    const q = req.query as { accountId?: string };
    let accountIdFilter: number | null = null;
    if (q.accountId) {
      const n = Number(q.accountId);
      if (!Number.isInteger(n) || n <= 0) {
        return reply.code(400).send({ error: 'invalid accountId' });
      }
      accountIdFilter = n;
    }
    const rows = await db.execute(sql`
      SELECT t.*
      FROM transactions t
      WHERE t.user_id = ${uid}
        AND (t.account_id, t.date, t.amount) IN (
          SELECT account_id, date, amount
          FROM transactions
          WHERE user_id = ${uid}
          ${accountIdFilter !== null ? sql`AND account_id = ${accountIdFilter}` : sql``}
          GROUP BY account_id, date, amount
          HAVING count(*) >= 2 AND count(distinct dedup_key) >= 2
        )
      ${accountIdFilter !== null ? sql`AND t.account_id = ${accountIdFilter}` : sql``}
      ORDER BY t.account_id, t.date DESC, t.amount, t.id
    `);
    const groupsMap = new Map<string, Array<Record<string, unknown>>>();
    for (const r of rows.rows as Array<Record<string, unknown>>) {
      const key = `${r.account_id}|${r.date}|${r.amount}`;
      const arr = groupsMap.get(key) ?? [];
      arr.push(r);
      groupsMap.set(key, arr);
    }
    const groups = Array.from(groupsMap.entries()).map(([k, txns]) => {
      const [accId, date, amount] = k.split('|');
      return {
        accountId: Number(accId),
        date,
        amount,
        transactions: txns,
      };
    });
    return { groups };
  });

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
