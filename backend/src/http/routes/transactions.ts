import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, gte, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { transactions } from '../../db/schema.js';

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
// frontend can update categoryId OR notes without sending the other.
const PatchBody = z.object({
  categoryId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

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

  app.get('/api/transactions', async (req, reply) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const q = parsed.data;

    const where: SQL[] = [];
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
    const id = parseId(req, reply);
    if (id === null) return;
    const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
    if (!row) return reply.code(404).send({ error: 'not found' });
    return { transaction: row };
  });

  // Inline category edit from the UI. Any explicit categoryId set via this
  // endpoint flips category_source to 'manual' — this is the flag the
  // retroactive recategorizer respects when `preserveManual: true`.
  app.patch('/api/transactions/:id', async (req, reply) => {
    const id = parseId(req, reply);
    if (id === null) return;
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    // Build the actual SET clause from the fields present in the patch.
    // category_source flips to 'manual' only when the categoryId itself is
    // touched — updating just a note shouldn't change provenance.
    const updates: { categoryId?: number | null; categorySource?: 'manual'; notes?: string | null } = {};
    if ('categoryId' in parsed.data) {
      updates.categoryId = parsed.data.categoryId ?? null;
      updates.categorySource = 'manual';
    }
    if ('notes' in parsed.data) {
      const raw = parsed.data.notes;
      // Empty string → null, so we don't store useless whitespace.
      updates.notes = raw && raw.trim() ? raw : null;
    }
    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'no fields to update' });
    }
    const [updated] = await db
      .update(transactions)
      .set(updates)
      .where(eq(transactions.id, id))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return { transaction: updated };
  });
}
