import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { userId } from '../../plugins/auth.js';
import { ListQuery } from './schemas.js';

export interface GoalListRow {
  id: number;
  accountId: number;
  name: string;
  targetAmount: string;
  targetDate: string | null;
  color: string | null;
  closedAt: string | null;
  currency: string;
  savedAmount: string;
  eventCount: number;
  rawPct: number;
  progressPct: number;
  perMonthNeeded: string | null;
  overdueDays: number | null;
}

// Pure functions kept exported so unit tests can pin the math without a DB.
// `todayIso` is injected for deterministic behaviour under time-travel tests.
export function computeProjection(opts: {
  target: number;
  saved: number;
  targetDate: string | null;
  todayIso: string;
}): { rawPct: number; progressPct: number; perMonthNeeded: string | null; overdueDays: number | null } {
  const target = opts.target;
  const saved = opts.saved;
  const rawPct = target > 0 ? (saved / target) * 100 : 0;
  const progressPct = Math.max(0, Math.min(100, rawPct));

  if (!opts.targetDate) return { rawPct, progressPct, perMonthNeeded: null, overdueDays: null };

  const target0 = new Date(`${opts.targetDate}T00:00:00Z`).getTime();
  const today0 = new Date(`${opts.todayIso}T00:00:00Z`).getTime();
  const dayMs = 86_400_000;

  if (target0 <= today0) {
    // On or past the deadline. Overdue only counts when the goal is still
    // under target; a reached-but-past goal is done, not overdue.
    if (saved >= target) return { rawPct, progressPct, perMonthNeeded: null, overdueDays: null };
    const overdueDays = Math.floor((today0 - target0) / dayMs);
    return { rawPct, progressPct, perMonthNeeded: null, overdueDays };
  }

  const remaining = target - saved;
  if (remaining <= 0) {
    // Already reached with time to spare — no monthly requirement.
    return { rawPct, progressPct, perMonthNeeded: '0.00', overdueDays: null };
  }
  // 30.44 days = mean gregorian month. Fractional months are honest here:
  // a target 15 days out demands "twice the monthly rate" from a user, and
  // the UI already trims the decimals appropriately.
  const monthsRemaining = Math.max((target0 - today0) / dayMs / 30.44, 1e-9);
  const perMonth = Math.ceil(remaining / monthsRemaining);
  return { rawPct, progressPct, perMonthNeeded: perMonth.toFixed(2), overdueDays: null };
}

function todayIso(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

export function registerList(app: FastifyInstance): void {
  app.get('/api/goals', async (req, reply) => {
    const q = ListQuery.safeParse(req.query);
    if (!q.success) {
      return reply.code(400).send({ error: 'invalid query', issues: q.error.issues });
    }
    const includeClosed = q.data.includeClosed === '1' || q.data.includeClosed === 'true';
    const uid = userId(req);

    const rows = await db.execute<{
      id: number;
      account_id: number;
      name: string;
      target_amount: string;
      target_date: string | null;
      color: string | null;
      // node-pg returns TIMESTAMPTZ as a Date; PGlite returns a string. Handle
      // both via a defensive Date coercion below.
      closed_at: Date | string | null;
      currency: string;
      saved_amount: string;
      event_count: number;
    }>(sql`
      SELECT
        g.id,
        g.account_id,
        g.name,
        g.target_amount::text                          AS target_amount,
        to_char(g.target_date, 'YYYY-MM-DD')           AS target_date,
        g.color,
        g.closed_at,
        a.currency                                     AS currency,
        COALESCE(
          (SELECT SUM(e.amount) FROM savings_goal_events e WHERE e.goal_id = g.id),
          0
        )::text                                        AS saved_amount,
        COALESCE(
          (SELECT COUNT(*) FROM savings_goal_events e WHERE e.goal_id = g.id),
          0
        )::int                                         AS event_count
      FROM savings_goals g
      JOIN accounts a ON a.id = g.account_id
      WHERE g.user_id = ${uid}
        AND (${includeClosed}::bool OR g.closed_at IS NULL)
      ORDER BY g.closed_at NULLS FIRST, g.created_at ASC
    `);

    const today = todayIso();
    const goals: GoalListRow[] = rows.rows.map((r) => {
      const target = Number(r.target_amount);
      const saved = Number(r.saved_amount);
      const proj = computeProjection({ target, saved, targetDate: r.target_date, todayIso: today });
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
    });

    // perAccount.savedSum aggregates only non-closed goals. The UI joins this
    // with useAccounts to decide `overReserved`; the balance-computation SQL
    // from accounts/list.ts is deliberately not duplicated here.
    const perAccount: Record<number, { savedSum: string }> = {};
    for (const g of goals) {
      if (g.closedAt) continue;
      const cur = perAccount[g.accountId];
      const sum = (cur ? Number(cur.savedSum) : 0) + Number(g.savedAmount);
      perAccount[g.accountId] = { savedSum: sum.toFixed(2) };
    }

    return { goals, perAccount };
  });
}
