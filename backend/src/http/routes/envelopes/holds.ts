import type { FastifyInstance } from 'fastify';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { envelopeMonthHolds } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { monthStr } from './schemas.js';
import { serializeHold } from './serializers.js';

export function registerHoldsRoutes(app: FastifyInstance): void {
  const HoldsQuery = z.object({
    from: z.string().regex(/^\d{4}-\d{2}$/).transform((s) => `${s}-01`),
    to:   z.string().regex(/^\d{4}-\d{2}$/).transform((s) => `${s}-01`),
  });
  app.get('/api/envelopes/holds', async (req, reply) => {
    const uid = userId(req);
    const parsed = HoldsQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid range' });
    const rows = await db
      .select()
      .from(envelopeMonthHolds)
      .where(and(
        eq(envelopeMonthHolds.userId, uid),
        gte(envelopeMonthHolds.month, parsed.data.from),
        lte(envelopeMonthHolds.month, parsed.data.to),
      ))
      .orderBy(asc(envelopeMonthHolds.month));
    return { holds: rows.map(serializeHold) };
  });

  const HoldPutBody = z.object({
    month: monthStr,
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'must be a non-negative decimal'),
  });
  app.put('/api/envelopes/holds', async (req, reply) => {
    const uid = userId(req);
    const parsed = HoldPutBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const { month, amount } = parsed.data;
    if (Number(amount) === 0) {
      await db
        .delete(envelopeMonthHolds)
        .where(and(eq(envelopeMonthHolds.userId, uid), eq(envelopeMonthHolds.month, month)));
      return { deleted: true };
    }
    const [row] = await db
      .insert(envelopeMonthHolds)
      .values({ userId: uid, month, amount })
      .onConflictDoUpdate({
        target: [envelopeMonthHolds.userId, envelopeMonthHolds.month],
        set: { amount, updatedAt: new Date() },
      })
      .returning();
    return { hold: serializeHold(row!) };
  });
}
