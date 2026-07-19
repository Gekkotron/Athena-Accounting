import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { recurringSeries, recurringSeriesTransactions } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';
import { runRecurringDetectionStandalone } from '../../services/recurring-detect.js';
import { addDays } from '../../domain/transfers/matching.js';

const UpdateBody = z.object({
  status: z.enum(['detected', 'confirmed', 'dismissed']).optional(),
  essentialness: z.enum(['essential', 'discretionary']).nullable().optional(),
});

const IdParam = z.object({ id: z.coerce.number().int().positive() });

// Cap the upcoming horizon server-side so an accidental unbounded
// request (e.g. ?upcoming=999999) can't force a full walk over every
// series' cadence chain.
const UPCOMING_MAX_DAYS = 180;

const ListQuery = z.object({
  // Positive integer; the server caps silently at UPCOMING_MAX_DAYS so a
  // request like ?upcoming=99999 degrades gracefully to the 180-day
  // window instead of erroring. Non-integer / zero / negative still 400.
  upcoming: z.coerce.number().int().positive().optional(),
});

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Walk `lastSeen` forward in cadence-day steps until reaching or passing
// today. Guarded loop bound because a corrupt row (cadenceDays=0) would
// otherwise spin forever — the CHECK constraint prevents this at the DB
// level but defence-in-depth is cheap.
function computeNextDue(lastSeen: string, cadenceDays: number, today: string): string {
  if (cadenceDays <= 0) return lastSeen;
  let next = lastSeen;
  for (let i = 0; i < 5000; i++) {
    if (next >= today) return next;
    next = addDays(next, cadenceDays);
  }
  return next;
}

export async function recurringRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/recurring', async (req, reply) => {
    const uid = userId(req);

    const queryParsed = ListQuery.safeParse(req.query);
    if (!queryParsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: queryParsed.error.issues });
    }
    const requestedHorizon = queryParsed.data.upcoming;

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

    if (requestedHorizon !== undefined) {
      // Cap silently — clients can request a larger value than the
      // server allows and the response degrades gracefully to the max
      // horizon. Alternative was to 400; PLAN.md's "capped at 180
      // server-side" phrasing implies a soft cap.
      const horizon = Math.min(UPCOMING_MAX_DAYS, requestedHorizon);
      const today = todayIso();
      const cutoff = addDays(today, horizon);
      const withNext = rows.map((r) => ({
        ...r,
        nextDueAt: computeNextDue(r.lastSeenAt, r.cadenceDays, today),
      }));
      const filtered = withNext.filter((r) => r.nextDueAt <= cutoff);
      filtered.sort((a, b) => a.nextDueAt.localeCompare(b.nextDueAt));
      return { recurring: filtered };
    }

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
