import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { accounts } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { CreateBody, UpdateBody } from './schemas.js';
import { isPgError, parseId } from './helpers.js';

// True iff the account has at least one mapped bank_connection_accounts
// row with a non-empty IBAN — in that case the synced IBAN is the
// authoritative value and the manual field is locked.
async function hasSyncedIban(accountId: number): Promise<boolean> {
  const result = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM bank_connection_accounts
      WHERE account_id = ${accountId}
        AND iban IS NOT NULL
        AND iban <> ''
    ) AS exists
  `);
  return result.rows[0]?.exists === true;
}

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
    // Reject manual IBAN edits on an account whose synced IBAN is the
    // authoritative value. We check only when the request actually touches
    // iban so pure name/type/… updates on a synced account still succeed.
    if (Object.prototype.hasOwnProperty.call(parsed.data, 'iban') && await hasSyncedIban(id)) {
      return reply.code(409).send({ error: 'iban is managed by bank sync and cannot be edited' });
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
      // foreign_key_violation — transactions.account_id has ON DELETE RESTRICT.
      // pglite emits 23001 (restrict_violation) for this same ON DELETE
      // RESTRICT case where real Postgres emits 23503 (foreign_key_violation);
      // both mean "account still referenced" here, so map both to 409.
      if (isPgError(err) && (err.code === '23503' || err.code === '23001')) {
        return reply
          .code(409)
          .send({ error: 'account has transactions; remove them first' });
      }
      throw err;
    }
  });
}
