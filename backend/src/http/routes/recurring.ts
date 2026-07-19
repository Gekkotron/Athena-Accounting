import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { recurringSeries, recurringSeriesTransactions } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';
import { runRecurringDetectionStandalone } from '../../services/recurring-detect.js';

const UpdateBody = z.object({
  status: z.enum(['detected', 'confirmed', 'dismissed']).optional(),
  essentialness: z.enum(['essential', 'discretionary']).nullable().optional(),
});

const IdParam = z.object({ id: z.coerce.number().int().positive() });

export async function recurringRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/recurring', async (req) => {
    const uid = userId(req);

    // memberCount comes from a correlated subquery over the join table
    // so the payload matches PLAN.md's shape ("includes member-
    // transaction count per series") without a second round-trip.
    const rows = await db
      .select({
        id: recurringSeries.id,
        label: recurringSeries.label,
        cadenceDays: recurringSeries.cadenceDays,
        avgAmount: recurringSeries.avgAmount,
        amountStddev: recurringSeries.amountStddev,
        categoryId: recurringSeries.categoryId,
        firstSeenAt: recurringSeries.firstSeenAt,
        lastSeenAt: recurringSeries.lastSeenAt,
        nextDueAt: recurringSeries.nextDueAt,
        status: recurringSeries.status,
        essentialness: recurringSeries.essentialness,
        createdAt: recurringSeries.createdAt,
        updatedAt: recurringSeries.updatedAt,
        memberCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${recurringSeriesTransactions}
          WHERE ${recurringSeriesTransactions.seriesId} = ${recurringSeries.id}
        )`,
      })
      .from(recurringSeries)
      .where(eq(recurringSeries.userId, uid))
      .orderBy(
        // Monthly-equivalent = avg_amount * (30.0 / cadence_days). ABS so
        // both incoming and outgoing recurring series sort by magnitude
        // (an income series worth €2000/month should rank above a €10/mo
        // subscription).
        desc(sql<number>`ABS(${recurringSeries.avgAmount}::numeric * 30.0 / ${recurringSeries.cadenceDays}::numeric)`),
      );

    return { recurring: rows };
  });

  app.put('/api/recurring/:id', async (req, reply) => {
    const uid = userId(req);
    const idParsed = IdParam.safeParse(req.params);
    if (!idParsed.success) return reply.code(400).send({ error: 'invalid id' });
    const id = idParsed.data.id;

    const bodyParsed = UpdateBody.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: bodyParsed.error.issues });
    }
    if (Object.keys(bodyParsed.data).length === 0) {
      return reply.code(400).send({ error: 'no fields to update' });
    }

    const [updated] = await db
      .update(recurringSeries)
      .set({ ...bodyParsed.data, updatedAt: new Date() })
      .where(and(eq(recurringSeries.id, id), eq(recurringSeries.userId, uid)))
      .returning();

    if (!updated) return reply.code(404).send({ error: 'not found' });
    return { recurring: updated };
  });

  app.post('/api/recurring/regenerate', async (req) => {
    const uid = userId(req);
    const result = await runRecurringDetectionStandalone(uid);
    return { ok: true, ...result };
  });
}
