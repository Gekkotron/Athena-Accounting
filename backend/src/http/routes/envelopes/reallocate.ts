import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { envelopeAssignments } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { monthStr } from './schemas.js';
import { expenseCategoryOwned } from './helpers.js';
import { serializeAssignment } from './serializers.js';

export function registerReallocateRoute(app: FastifyInstance): void {
  const ReallocBody = z.object({
    fromCategoryId: z.number().int().positive(),
    toCategoryId: z.number().int().positive(),
    month: monthStr,
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'must be a positive decimal'),
  });
  app.post('/api/envelopes/reallocate', async (req, reply) => {
    const uid = userId(req);
    const parsed = ReallocBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const { fromCategoryId, toCategoryId, month, amount } = parsed.data;
    if (fromCategoryId === toCategoryId) {
      return reply.code(400).send({ error: 'same_category' });
    }
    if (!(await expenseCategoryOwned(uid, fromCategoryId))
      || !(await expenseCategoryOwned(uid, toCategoryId))) {
      return reply.code(400).send({ error: 'category_not_expense' });
    }

    const result = await db.transaction(async (tx) => {
      // Insert-then-add-on-conflict so two concurrent reallocations targeting
      // a not-yet-existing (userId, categoryId, month) row can't both INSERT
      // and race the unique index — the pattern used by assignments.ts.
      async function bumpBy(catId: number, delta: string) {
        const [row] = await tx
          .insert(envelopeAssignments)
          .values({
            userId: uid,
            categoryId: catId,
            month,
            amount: delta,
          })
          .onConflictDoUpdate({
            target: [envelopeAssignments.userId, envelopeAssignments.categoryId, envelopeAssignments.month],
            set: {
              amount: sql`${envelopeAssignments.amount} + excluded.amount`,
              updatedAt: new Date(),
            },
          })
          .returning();
        return row!;
      }

      const from = await bumpBy(fromCategoryId, `-${amount}`);
      const to = await bumpBy(toCategoryId, amount);
      return { from, to };
    });

    return reply.code(200).send({
      from: serializeAssignment(result.from),
      to:   serializeAssignment(result.to),
    });
  });
}
