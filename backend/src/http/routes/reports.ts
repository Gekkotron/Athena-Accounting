import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { userId } from '../plugins/auth.js';

const RangeQuery = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  granularity: z.enum(['day', 'month']).default('day'),
  // Optional per-account filter. Applied to the categories report so the
  // Dashboard donut can follow the currently-scoped account. Not applied to
  // the other endpoints in this file — they aggregate across accounts by
  // design.
  accountId: z.coerce.number().int().positive().optional(),
});

const BudgetQuery = z.object({
  period: z.enum(['monthly', 'yearly']).default('monthly'),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM').optional(),
  year: z.string().regex(/^\d{4}$/, 'must be YYYY').optional(),
  accountId: z.coerce.number().int().positive().optional(),
});

// Shared "effective transactions" CTE body: a transaction with no splits
// contributes itself; a split transaction contributes one row per split (each
// attributed to its own split category). Used by both the categories report and
// the budget report so they count splits identically. Includes account_id — the
// categories report filters on it; the budget report simply ignores that column.
const TX_EFFECTIVE_CTE = sql`
      tx_effective AS (
        SELECT t.id, t.user_id, t.account_id, t.date, t.transfer_group_id,
               t.category_id, t.amount
          FROM transactions t
         WHERE NOT EXISTS (
           SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id
         )
        UNION ALL
        SELECT t.id, t.user_id, t.account_id, t.date, t.transfer_group_id,
               s.category_id, s.amount
          FROM transactions t
          JOIN transaction_splits s ON s.transaction_id = t.id
      )`;

// Days elapsed inside [start, endExclusive), clamped to the window. Uses UTC
// midnight of `today` so the boundary is consistent with the SQL date filter.
// - Strictly past periods (today's midnight >= endExclusive) clamp to the
//   whole window (elapsedDays === windowDays).
// - Strictly future periods (today's midnight < start) are 0.
// - Otherwise (today falls inside [start, endExclusive)) day 1 of the period
//   counts as elapsedDays = 1, day 2 as 2, etc. (inclusive of today).
function elapsedIn(start: Date, endExclusive: Date, now: Date): number {
  const todayUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (todayUtcMidnight >= endExclusive) {
    return Math.round((endExclusive.getTime() - start.getTime()) / 86_400_000);
  }
  if (todayUtcMidnight < start) return 0;
  return Math.round((todayUtcMidnight.getTime() - start.getTime()) / 86_400_000) + 1;
}

// projected = null when it's too early in the current period to extrapolate
// (elapsedDays < 3); locked to `spent` for strictly past periods; otherwise a
// linear extrapolation of spend across the whole window.
function computeProjected(
  spent: number,
  elapsedDays: number,
  windowDays: number,
  endExclusive: Date,
  now: Date,
): string | null {
  // Past period → projected == spent (locked).
  if (now >= endExclusive) return spent.toFixed(2);
  // Too early to project.
  if (elapsedDays < 3) return null;
  return (spent / elapsedDays * windowDays).toFixed(2);
}

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  // Total balance grouped by currency. Multi-currency accounts are returned
  // separately (no auto-conversion).
  app.get('/api/reports/balance', async (req) => {
    const uid = userId(req);
    // available = balance not locked by lock_years (Disponible + Placé combined).
    // invested = the subset of `available` that lives in an account whose type
    // is 'investment'. Client computes: disponible = available - invested;
    // bloqué = total - available.
    const rows = await db.execute<{
      currency: string;
      total: string;
      available: string;
      invested: string;
      account_count: number;
    }>(sql`
      WITH per_account AS (
        SELECT
          a.currency,
          a.type,
          (
            a.opening_balance + COALESCE(
              (SELECT SUM(t.amount) FROM transactions t
                WHERE t.account_id = a.id AND t.date >= a.opening_date),
              0
            )
          ) AS total,
          (
            (CASE
               WHEN a.lock_years IS NULL
                 OR (a.opening_date + (INTERVAL '1 year' * a.lock_years))::date <= CURRENT_DATE
               THEN a.opening_balance
               ELSE 0
             END)
            + COALESCE(
                (SELECT SUM(t.amount) FROM transactions t
                  WHERE t.account_id = a.id AND t.date >= a.opening_date
                    AND (
                      CASE
                        WHEN t.lock_years IS NOT NULL
                          THEN (t.date + (INTERVAL '1 year' * t.lock_years))::date <= CURRENT_DATE
                        WHEN a.lock_years IS NOT NULL
                          THEN (a.opening_date + (INTERVAL '1 year' * a.lock_years))::date <= CURRENT_DATE
                        ELSE TRUE
                      END
                    )),
                0)
          ) AS available
        FROM accounts a
        WHERE a.user_id = ${uid}
      )
      SELECT
        currency,
        SUM(total)::text AS total,
        SUM(available)::text AS available,
        SUM(CASE WHEN type = 'investment' THEN available ELSE 0 END)::text AS invested,
        COUNT(*)::int AS account_count
      FROM per_account
      GROUP BY currency
      ORDER BY currency
    `);
    return { perCurrency: rows.rows };
  });

  // Running balance per account over time. Returns one row per (account, date)
  // with the cumulative balance after that date's transactions. Transfer legs
  // ARE included here — they affect per-account balances even though they're
  // neutral overall.
  app.get('/api/reports/timeseries', async (req, reply) => {
    const uid = userId(req);
    const parsed = RangeQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const { fromDate, toDate, granularity } = parsed.data;

    const truncFmt = granularity === 'month' ? "'month'" : "'day'";

    const rows = await db.execute<{
      account_id: number;
      currency: string;
      bucket: string;
      delta: string;
      cumulative: string;
    }>(sql`
      WITH per_bucket AS (
        SELECT
          t.account_id,
          a.currency,
          to_char(date_trunc(${sql.raw(truncFmt)}, t.date::timestamp), 'YYYY-MM-DD') AS bucket,
          SUM(t.amount) AS delta
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        WHERE t.user_id = ${uid}
          ${fromDate ? sql`AND t.date >= ${fromDate}` : sql``}
          ${toDate ? sql`AND t.date <= ${toDate}` : sql``}
        GROUP BY t.account_id, a.currency, bucket
      ),
      with_opening AS (
        SELECT
          a.id AS account_id,
          a.currency,
          'opening' AS kind,
          to_char(a.opening_date::timestamp, 'YYYY-MM-DD') AS bucket,
          a.opening_balance AS delta
        FROM accounts a
        WHERE a.user_id = ${uid}
        UNION ALL
        SELECT account_id, currency, 'tx' AS kind, bucket, delta FROM per_bucket
      )
      SELECT
        account_id,
        currency,
        bucket,
        SUM(delta)::text AS delta,
        SUM(SUM(delta)) OVER (
          PARTITION BY account_id
          ORDER BY bucket
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )::text AS cumulative
      FROM with_opening
      GROUP BY account_id, currency, bucket
      ORDER BY account_id, bucket
    `);

    return { points: rows.rows };
  });

  // Spending breakdown by category over a date range. Excludes transfers and
  // excludes positive-only category kinds when the user is only interested in
  // expenses (we just return everything and let the UI filter — keeps the API
  // simple).
  app.get('/api/reports/categories', async (req, reply) => {
    const uid = userId(req);
    const parsed = RangeQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const { fromDate, toDate, accountId } = parsed.data;

    const rows = await db.execute<{
      category_id: number | null;
      category_name: string | null;
      category_kind: string | null;
      category_is_internal_transfer: boolean | null;
      month: string;
      total: string;
      transaction_count: number;
    }>(sql`
      -- transaction_count below counts virtual rows: a transaction with no
      -- splits contributes 1, but an N-way split contributes N rows (one per
      -- split), each attributed to its own split category.
      WITH ${TX_EFFECTIVE_CTE}
      SELECT
        c.id AS category_id,
        c.name AS category_name,
        c.kind AS category_kind,
        c.is_internal_transfer AS category_is_internal_transfer,
        to_char(date_trunc('month', e.date::timestamp), 'YYYY-MM') AS month,
        SUM(e.amount)::text AS total,
        COUNT(*)::int AS transaction_count
      FROM tx_effective e
      LEFT JOIN categories c ON c.id = e.category_id
      WHERE e.user_id = ${uid}
        AND e.transfer_group_id IS NULL
        ${fromDate ? sql`AND e.date >= ${fromDate}` : sql``}
        ${toDate ? sql`AND e.date <= ${toDate}` : sql``}
        ${accountId ? sql`AND e.account_id = ${accountId}` : sql``}
      GROUP BY c.id, c.name, c.kind, month
      ORDER BY month DESC, total ASC
    `);

    return { rows: rows.rows };
  });

  // Planned-vs-actual per budgeted expense category for one period (a
  // calendar month or a calendar year, per `period`), optionally scoped to
  // one account. Reuses the tx_effective CTE from /api/reports/categories so
  // splits count per split-category and internal transfers are excluded.
  // Only categories that have a budget row (matching `period` + account
  // scope) appear. spent = -SUM(amount) (expenses are stored negative); a
  // budgeted category with no spend that period returns "0.00". Parent
  // budgets roll up own + direct children (depth cap = 2). `projected`
  // extrapolates spend across the whole window once >= 3 days have elapsed,
  // is locked to `spent` for periods already in the past, and is `null`
  // otherwise (too early in the current period to extrapolate).
  app.get('/api/reports/budget', async (req, reply) => {
    const uid = userId(req);
    const parsed = BudgetQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const { period, accountId } = parsed.data;

    // Resolve the period bounds and windowDays/elapsedDays.
    const now = new Date();
    const [periodStart, periodEndExclusive, windowDays, elapsedDays, monthOut, yearOut] =
      (() => {
        if (period === 'monthly') {
          const m = parsed.data.month
            ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const [y, mm] = m.split('-').map(Number);
          const start = new Date(Date.UTC(y!, mm! - 1, 1));
          const end = new Date(Date.UTC(y!, mm!, 1));
          const wDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
          const eDays = elapsedIn(start, end, now);
          return [start, end, wDays, eDays, m, undefined] as const;
        } else {
          const y = parsed.data.year ?? String(now.getFullYear());
          const yn = Number(y);
          const start = new Date(Date.UTC(yn, 0, 1));
          const end = new Date(Date.UTC(yn + 1, 0, 1));
          const wDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
          const eDays = elapsedIn(start, end, now);
          return [start, end, wDays, eDays, undefined, y] as const;
        }
      })();

    const startIso = periodStart.toISOString().slice(0, 10); // YYYY-MM-DD
    const endIso = periodEndExclusive.toISOString().slice(0, 10);

    // Rows: for each budget matching the period + account scope, its rolled-up
    // spend inside the period. Global budgets (account_id IS NULL) always count;
    // scoped budgets require accountId param equality (or no filter).
    const result = await db.execute<{
      id: number;
      category_id: number;
      name: string;
      color: string | null;
      limit: string;
      currency: string;
      period: string;
      account_id: number | null;
      spent: string;
    }>(sql`
      WITH ${TX_EFFECTIVE_CTE}
      SELECT
        b.id                                        AS id,
        b.category_id                               AS category_id,
        c.name                                      AS name,
        c.color                                     AS color,
        b.monthly_limit::text                       AS limit,
        b.currency                                  AS currency,
        b.period                                    AS period,
        b.account_id                                AS account_id,
        COALESCE(-SUM(e.amount), 0)::text           AS spent
      FROM category_budgets b
      JOIN categories c ON c.id = b.category_id AND c.user_id = ${uid}
      LEFT JOIN tx_effective e
        ON (
          e.category_id = b.category_id
          OR e.category_id IN (
            SELECT cc.id FROM categories cc
            WHERE cc.parent_id = b.category_id AND cc.user_id = ${uid}
          )
        )
       AND e.user_id = ${uid}
       AND e.transfer_group_id IS NULL
       AND e.date >= ${startIso}::date
       AND e.date <  ${endIso}::date
       AND (${accountId ?? null}::int IS NULL OR e.account_id = ${accountId ?? null}::int)
      WHERE b.user_id = ${uid}
        AND b.period = ${period}
        AND (
          b.account_id IS NULL
          OR (${accountId ?? null}::int IS NULL AND b.account_id IS NOT NULL)
          OR b.account_id = ${accountId ?? null}::int
        )
      GROUP BY b.id, b.category_id, c.name, c.color, b.monthly_limit, b.currency, b.period, b.account_id
      ORDER BY c.name ASC
    `);

    // When accountId IS provided, hide budgets scoped to OTHER accounts (SQL
    // above lets global rows and rows scoped to this account through; this
    // pass makes that intent explicit and defensive).
    const rowsFiltered = result.rows.filter((r) =>
      accountId == null ? true : r.account_id == null || r.account_id === accountId
    );

    let totalLimit = 0;
    let totalSpent = 0;
    let totalProjected: number | null = 0;
    const rows = rowsFiltered.map((r) => {
      const limit = Number(r.limit);
      const spent = Number(r.spent);
      totalLimit += limit;
      totalSpent += spent;
      const projected = computeProjected(spent, elapsedDays, windowDays, periodEndExclusive, now);
      if (totalProjected !== null) {
        if (projected == null) totalProjected = null;
        else totalProjected += Number(projected);
      }
      return {
        categoryId: r.category_id,
        name: r.name,
        color: r.color,
        accountId: r.account_id,
        period: r.period as 'monthly' | 'yearly',
        limit: r.limit,
        currency: r.currency,
        spent: spent.toFixed(2),
        remaining: (limit - spent).toFixed(2),
        pct: limit > 0 ? Math.round((spent / limit) * 100) : 0,
        over: spent > limit,
        projected,
      };
    });

    const response: {
      period: 'monthly' | 'yearly';
      month?: string; year?: string;
      windowDays: number; elapsedDays: number;
      rows: typeof rows;
      totals: { limit: string; spent: string; remaining: string; projected: string | null };
    } = {
      period,
      windowDays, elapsedDays,
      rows,
      totals: {
        limit: totalLimit.toFixed(2),
        spent: totalSpent.toFixed(2),
        remaining: (totalLimit - totalSpent).toFixed(2),
        projected: totalProjected == null ? null : totalProjected.toFixed(2),
      },
    };
    if (monthOut) response.month = monthOut;
    if (yearOut) response.year = yearOut;
    return response;
  });
}
