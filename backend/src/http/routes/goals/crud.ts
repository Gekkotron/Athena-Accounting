import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { accounts, savingsGoals } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { parseId, isPgError } from '../../../lib/http.js';
import { CreateGoalBody, UpdateGoalBody } from './schemas.js';
import { computeProjection } from './list.js';

// Non-enumeration 404: cross-user access returns 404 rather than 403, so an
// attacker can't tell "id belongs to another user" from "id doesn't exist".
async function loadOwnGoalRaw(uid: number, id: number) {
  const [row] = await db
    .select()
    .from(savingsGoals)
    .where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, uid)));
  return row ?? null;
}

async function hydrateGoal(uid: number, id: number) {
  const rows = await db.execute<{
    id: number;
    account_id: number;
    name: string;
    target_amount: string;
    target_date: string | null;
    color: string | null;
    // See list.ts — PGlite vs node-pg TIMESTAMPTZ representation.
    closed_at: Date | string | null;
    currency: string;
    saved_amount: string;
    event_count: number;
  }>(sql`
    SELECT
      g.id, g.account_id, g.name,
      g.target_amount::text                     AS target_amount,
      to_char(g.target_date, 'YYYY-MM-DD')      AS target_date,
      g.color, g.closed_at,
      a.currency                                AS currency,
      COALESCE((SELECT SUM(e.amount) FROM savings_goal_events e WHERE e.goal_id = g.id), 0)::text AS saved_amount,
      COALESCE((SELECT COUNT(*)      FROM savings_goal_events e WHERE e.goal_id = g.id), 0)::int  AS event_count
    FROM savings_goals g
    JOIN accounts a ON a.id = g.account_id
    WHERE g.id = ${id} AND g.user_id = ${uid}
  `);
  const r = rows.rows[0];
  if (!r) return null;
  const now = new Date();
  const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  const proj = computeProjection({
    target: Number(r.target_amount),
    saved: Number(r.saved_amount),
    targetDate: r.target_date,
    todayIso: today,
  });
  return {
    id: r.id,
    accountId: r.account_id,
    name: r.name,
    targetAmount: r.target_amount,
    targetDate: r.target_date,
    color: r.color,
    closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
    currency: r.currency,
    savedAmount: r.saved_amount,
    eventCount: r.event_count,
    rawPct: proj.rawPct,
    progressPct: proj.progressPct,
    perMonthNeeded: proj.perMonthNeeded,
    overdueDays: proj.overdueDays,
  };
}

export function registerCrud(app: FastifyInstance): void {
  app.post('/api/goals', async (req, reply) => {
    const uid = userId(req);
    const parsed = CreateGoalBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const body = parsed.data;
    // Verify the target account belongs to this user — non-enumeration 404.
    const [acc] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, body.accountId), eq(accounts.userId, uid)));
    if (!acc) return reply.code(404).send({ error: 'not found' });

    try {
      const [created] = await db
        .insert(savingsGoals)
        .values({
          userId: uid,
          accountId: body.accountId,
          name: body.name,
          targetAmount: body.targetAmount,
          targetDate: body.targetDate ?? null,
          color: body.color ?? null,
        })
        .returning();
      if (!created) throw new Error('insert returned no row');
      const goal = await hydrateGoal(uid, created.id);
      return reply.code(201).send({ goal });
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({ error: 'goal name already exists on this account' });
      }
      throw err;
    }
  });

  app.get('/api/goals/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const goal = await hydrateGoal(uid, id);
    if (!goal) return reply.code(404).send({ error: 'not found' });
    return { goal };
  });

  app.put('/api/goals/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const parsed = UpdateGoalBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'no fields to update' });
    }
    // Confirm ownership up-front so cross-user PUTs stay non-enumerating.
    const existing = await loadOwnGoalRaw(uid, id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const patch: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
    try {
      const [updated] = await db
        .update(savingsGoals)
        .set(patch)
        .where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, uid)))
        .returning();
      if (!updated) return reply.code(404).send({ error: 'not found' });
      const goal = await hydrateGoal(uid, id);
      return { goal };
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({ error: 'goal name already exists on this account' });
      }
      throw err;
    }
  });

  app.post('/api/goals/:id/close', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const existing = await loadOwnGoalRaw(uid, id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    if (existing.closedAt) return reply.code(409).send({ error: 'goal is already closed' });
    await db
      .update(savingsGoals)
      .set({ closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, uid)));
    const goal = await hydrateGoal(uid, id);
    return { goal };
  });

  app.post('/api/goals/:id/reopen', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const existing = await loadOwnGoalRaw(uid, id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    if (!existing.closedAt) return reply.code(409).send({ error: 'goal is not closed' });
    await db
      .update(savingsGoals)
      .set({ closedAt: null, updatedAt: new Date() })
      .where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, uid)));
    const goal = await hydrateGoal(uid, id);
    return { goal };
  });

  app.delete('/api/goals/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const [deleted] = await db
      .delete(savingsGoals)
      .where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, uid)))
      .returning({ id: savingsGoals.id });
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });
}
