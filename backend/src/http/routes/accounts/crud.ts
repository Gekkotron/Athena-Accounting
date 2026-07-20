import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { accounts } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { CreateBody, UpdateBody } from './schemas.js';
import { isPgError, parseId } from './helpers.js';

// POST/GET-by-id/PUT/DELETE for /api/accounts/:id — the CRUD trio.
// The list endpoint (with its computed balance SQL) lives in ./list.ts;
// merge lives in ./merge.ts.
export function registerCrud(app: FastifyInstance): void {
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
}
