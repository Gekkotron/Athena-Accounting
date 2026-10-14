import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { accountValuations, accounts } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { todayLocalIso } from '../../../lib/dates.js';
import { ValuationBody, ValuationParams } from './schemas.js';
import { parseId } from './helpers.js';

// Manual valuations for investment accounts — see migration 0047.
// GET lists newest first, PUT upserts on (account_id, date), DELETE removes
// one row. All three scope by the caller's user_id.
export function registerValuations(app: FastifyInstance): void {
  async function findOwnedAccount(uid: number, id: number) {
    const [row] = await db
      .select({ id: accounts.id, type: accounts.type })
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, uid)));
    return row;
  }

  app.get('/api/accounts/:id/valuations', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    if (!(await findOwnedAccount(uid, id))) return reply.code(404).send({ error: 'not found' });
    return db
      .select({
        id: accountValuations.id,
        date: accountValuations.date,
        value: accountValuations.value,
        source: accountValuations.source,
      })
      .from(accountValuations)
      .where(and(eq(accountValuations.accountId, id), eq(accountValuations.userId, uid)))
      .orderBy(desc(accountValuations.date));
  });

  app.put('/api/accounts/:id/valuations', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const parsed = ValuationBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const account = await findOwnedAccount(uid, id);
    if (!account) return reply.code(404).send({ error: 'not found' });
    if (account.type !== 'investment') {
      return reply.code(400).send({ error: 'valuations are only supported on investment accounts' });
    }
    if (parsed.data.date > todayLocalIso()) {
      return reply.code(400).send({ error: 'valuation date cannot be in the future' });
    }
    const [row] = await db
      .insert(accountValuations)
      .values({
        userId: uid,
        accountId: id,
        date: parsed.data.date,
        value: parsed.data.value,
        source: 'manual',
      })
      .onConflictDoUpdate({
        target: [accountValuations.accountId, accountValuations.date],
        set: { value: parsed.data.value, source: 'manual' },
      })
      .returning({
        id: accountValuations.id,
        date: accountValuations.date,
        value: accountValuations.value,
        source: accountValuations.source,
      });
    return row;
  });

  app.delete('/api/accounts/:id/valuations/:valuationId', async (req, reply) => {
    const uid = userId(req);
    const parsed = ValuationParams.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid id' });
    const [deleted] = await db
      .delete(accountValuations)
      .where(
        and(
          eq(accountValuations.id, parsed.data.valuationId),
          eq(accountValuations.accountId, parsed.data.id),
          eq(accountValuations.userId, uid),
        ),
      )
      .returning({ id: accountValuations.id });
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });
}
