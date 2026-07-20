import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
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
      async function bumpBy(catId: number, delta: string) {
        // Upsert: current amount is unknown; use SQL expression to add.
        const [existing] = await tx
          .select()
          .from(envelopeAssignments)
          .where(and(
            eq(envelopeAssignments.userId, uid),
            eq(envelopeAssignments.categoryId, catId),
            eq(envelopeAssignments.month, month),
          ));
        if (existing) {
          const [updated] = await tx
            .update(envelopeAssignments)
            .set({
              amount: sql`${envelopeAssignments.amount} + ${delta}::numeric`,
              updatedAt: new Date(),
            })
            .where(and(
              eq(envelopeAssignments.id, existing.id),
              eq(envelopeAssignments.userId, uid),
            ))
            .returning();
          return updated!;
        }
        const [created] = await tx
          .insert(envelopeAssignments)
          .values({
            userId: uid,
            categoryId: catId,
            month,
            amount: delta,
          })
          .returning();
        return created!;
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
