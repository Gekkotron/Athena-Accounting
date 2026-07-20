import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { accounts } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { ReorderBody } from './schemas.js';

// PUT /api/accounts/order { ids: [3, 1, 2] } assigns display_order = index
// to each id in the array. Wrapped in a transaction so a partial failure
// leaves the previous order intact.
export function registerReorder(app: FastifyInstance): void {
  app.put('/api/accounts/order', async (req, reply) => {
    const parsed = ReorderBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const { ids } = parsed.data;
    if (new Set(ids).size !== ids.length) {
      return reply.code(400).send({ error: 'duplicate ids in order list' });
    }
    const uid = userId(req);
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx
          .update(accounts)
          .set({ displayOrder: i })
          .where(and(eq(accounts.id, ids[i]!), eq(accounts.userId, uid)));
      }
    });
    return { ok: true };
  });
}
