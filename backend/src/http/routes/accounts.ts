import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, transactions } from '../../db/schema.js';

const decimal = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 fraction digits');

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be ISO date YYYY-MM-DD');

const isoCurrency = z
  .string()
  .regex(/^[A-Z]{3}$/, 'must be ISO 4217 3-letter code');

const CreateBody = z.object({
  name: z.string().trim().min(1).max(128),
  type: z.string().trim().min(1).max(64),
  currency: isoCurrency.default('EUR'),
  openingBalance: decimal.default('0'),
  openingDate: isoDate,
});

const UpdateBody = z
  .object({
    name: z.string().trim().min(1).max(128),
    type: z.string().trim().min(1).max(64),
    currency: isoCurrency,
    openingBalance: decimal,
    openingDate: isoDate,
  })
  .partial();

const IdParam = z.object({ id: z.coerce.number().int().positive() });

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
  app.get('/api/accounts', async () => {
    const result = await db.execute<{
      id: number;
      name: string;
      type: string;
      currency: string;
      opening_balance: string;
      opening_date: string;
      display_order: number;
      created_at: Date;
      current_balance: string;
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
        (
          a.opening_balance + COALESCE(
            (SELECT SUM(t.amount) FROM transactions t
              WHERE t.account_id = a.id AND t.date >= a.opening_date),
            0
          )
        )::text                                                AS current_balance,
        (SELECT COUNT(*)::int FROM transactions t
          WHERE t.account_id = a.id)                           AS transaction_count,
        (SELECT COUNT(*)::int FROM transactions t
          WHERE t.account_id = a.id AND t.date >= a.opening_date)
                                                               AS counted_transaction_count
      FROM accounts a
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
      currentBalance: r.current_balance,
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
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx
          .update(accounts)
          .set({ displayOrder: i })
          .where(eq(accounts.id, ids[i]!));
      }
    });
    return { ok: true };
  });

  app.post('/api/accounts', async (req, reply) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    try {
      const [created] = await db.insert(accounts).values(parsed.data).returning();
      return reply.code(201).send({ account: created });
    } catch (err) {
      // unique_violation on `name`
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({ error: 'account name already exists' });
      }
      throw err;
    }
  });

  app.get('/api/accounts/:id', async (req, reply) => {
    const id = parseId(req, reply);
    if (id === null) return;
    const [row] = await db.select().from(accounts).where(eq(accounts.id, id));
    if (!row) return reply.code(404).send({ error: 'not found' });
    return { account: row };
  });

  app.put('/api/accounts/:id', async (req, reply) => {
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
        .where(eq(accounts.id, id))
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
    const id = parseId(req, reply);
    if (id === null) return;
    try {
      const [deleted] = await db
        .delete(accounts)
        .where(eq(accounts.id, id))
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
}

function isPgError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string';
}
