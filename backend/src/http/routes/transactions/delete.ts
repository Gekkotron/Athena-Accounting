import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { transactions } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { parseId } from './helpers.js';

// Delete a single transaction. If the row is half of a linked internal
// transfer pair, also unlink the mirror leg so it doesn't silently become
// an "invisible" orphan (transfer_group_id IS NULL filters in the
// aggregates would otherwise hide it).
export function registerDelete(app: FastifyInstance): void {
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
