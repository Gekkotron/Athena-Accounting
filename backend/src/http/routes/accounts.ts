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

  // List accounts with computed current balance.
  app.get('/api/accounts', async () => {
    const rows = await db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        currency: accounts.currency,
        openingBalance: accounts.openingBalance,
        openingDate: accounts.openingDate,
        createdAt: accounts.createdAt,
        currentBalance: sql<string>`
          (${accounts.openingBalance} + COALESCE(
            (SELECT SUM(${transactions.amount})
             FROM ${transactions}
             WHERE ${transactions.accountId} = ${accounts.id}
               AND ${transactions.date} >= ${accounts.openingDate}),
            0
          ))::text
        `.as('current_balance'),
      })
      .from(accounts)
      .orderBy(accounts.name);
    return { accounts: rows };
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
