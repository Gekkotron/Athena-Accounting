import type { FastifyInstance } from 'fastify';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { savingsGoals, savingsGoalEvents } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { parseId } from '../../../lib/http.js';
import { CreateEventBody, UpdateEventBody, EventsQuery } from './schemas.js';

function serializeEvent(row: typeof savingsGoalEvents.$inferSelect) {
  // PGlite emits TIMESTAMPTZ as a string; node-pg emits Date. Coerce so both
  // paths yield the same ISO string on the wire.
  return {
    id: row.id,
    goalId: row.goalId,
    amount: row.amount,
    eventDate: row.eventDate,
    note: row.note,
    createdAt: new Date(row.createdAt as unknown as string | Date).toISOString(),
  };
}

// Loads the goal and returns { row } | null. Cross-user goals resolve to
// null so callers stay on the non-enumeration 404 path.
async function loadOwnGoal(uid: number, goalId: number) {
  const [row] = await db
    .select()
    .from(savingsGoals)
    .where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.userId, uid)));
  return row ?? null;
}

export function registerEvents(app: FastifyInstance): void {
  app.get('/api/goals/:id/events', async (req, reply) => {
    const uid = userId(req);
    const goalId = parseId(req, reply);
    if (goalId === null) return;
    const goal = await loadOwnGoal(uid, goalId);
    if (!goal) return reply.code(404).send({ error: 'not found' });

    const q = EventsQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid query', issues: q.error.issues });
    const limit = q.data.limit ?? 50;
    const before = q.data.before;

    const rows = await db
      .select()
      .from(savingsGoalEvents)
      .where(
        before
          ? and(eq(savingsGoalEvents.goalId, goalId), lt(savingsGoalEvents.id, before))
          : eq(savingsGoalEvents.goalId, goalId),
      )
      .orderBy(desc(savingsGoalEvents.id))
      .limit(limit);
    return { events: rows.map(serializeEvent) };
  });

  app.post('/api/goals/:id/events', async (req, reply) => {
    const uid = userId(req);
    const goalId = parseId(req, reply);
    if (goalId === null) return;
    const parsed = CreateEventBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const body = parsed.data;

    // justReached must observe both the pre- and post-insert sums under one
    // read snapshot, otherwise a concurrent insert could flip the transition
    // twice. Wrapping the read + insert in a single transaction is enough.
    const result = await db.transaction(async (tx) => {
      const [goal] = await tx
        .select()
        .from(savingsGoals)
        .where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.userId, uid)));
      if (!goal) return { kind: 'not_found' as const };
      if (goal.closedAt) return { kind: 'closed' as const };

      const [before] = await tx
        .select({ sum: sql<string | null>`COALESCE(SUM(${savingsGoalEvents.amount}), 0)::text` })
        .from(savingsGoalEvents)
        .where(eq(savingsGoalEvents.goalId, goalId));
      const savedBefore = Number(before?.sum ?? '0');

      const [created] = await tx
        .insert(savingsGoalEvents)
        .values({
          userId: uid,
          goalId,
          amount: body.amount,
          eventDate: body.eventDate,
          note: body.note ?? null,
        })
        .returning();
      if (!created) throw new Error('insert returned no row');

      const savedAfter = savedBefore + Number(body.amount);
      const target = Number(goal.targetAmount);
      const justReached = savedBefore < target && savedAfter >= target;
      return { kind: 'ok' as const, created, justReached };
    });

    if (result.kind === 'not_found') return reply.code(404).send({ error: 'not found' });
    if (result.kind === 'closed') return reply.code(400).send({ error: 'goal is closed' });
    return reply.code(201).send({
      event: serializeEvent(result.created),
      justReached: result.justReached,
    });
  });

  app.put('/api/goals/:id/events/:eventId', async (req, reply) => {
    const uid = userId(req);
    const goalId = parseId(req, reply);
    if (goalId === null) return;
    const params = req.params as { eventId?: string };
    const eventId = Number(params.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return reply.code(400).send({ error: 'invalid id' });
    }
    const parsed = UpdateEventBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'no fields to update' });
    }

    const goal = await loadOwnGoal(uid, goalId);
    if (!goal) return reply.code(404).send({ error: 'not found' });

    const [updated] = await db
      .update(savingsGoalEvents)
      .set(parsed.data)
      .where(
        and(
          eq(savingsGoalEvents.id, eventId),
          eq(savingsGoalEvents.goalId, goalId),
          eq(savingsGoalEvents.userId, uid),
        ),
      )
      .returning();
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return { event: serializeEvent(updated) };
  });

  app.delete('/api/goals/:id/events/:eventId', async (req, reply) => {
    const uid = userId(req);
    const goalId = parseId(req, reply);
    if (goalId === null) return;
    const params = req.params as { eventId?: string };
    const eventId = Number(params.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return reply.code(400).send({ error: 'invalid id' });
    }
    const goal = await loadOwnGoal(uid, goalId);
    if (!goal) return reply.code(404).send({ error: 'not found' });
    const [deleted] = await db
      .delete(savingsGoalEvents)
      .where(
        and(
          eq(savingsGoalEvents.id, eventId),
          eq(savingsGoalEvents.goalId, goalId),
          eq(savingsGoalEvents.userId, uid),
        ),
      )
      .returning({ id: savingsGoalEvents.id });
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });
}
