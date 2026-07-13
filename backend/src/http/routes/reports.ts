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

// Six most recent *completed* periods before `currentStart`, oldest first.
// Monthly: 'YYYY-MM' keys for the 6 calendar months before currentStart.
// Yearly: 'YYYY' keys for the 6 calendar years before currentStart's year.
function priorPeriodKeys(period: 'monthly' | 'yearly', currentStart: Date): string[] {
  const keys: string[] = [];
  if (period === 'monthly') {
    for (let i = 6; i >= 1; i--) {
      const d = new Date(Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth() - i, 1));
      keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
  } else {
    for (let i = 6; i >= 1; i--) {
      keys.push(String(currentStart.getUTCFullYear() - i));
    }
  }
  return keys;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / (values.length || 1);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const v = values.reduce((sum, x) => sum + (x - m) ** 2, 0) / values.length;
  return Math.sqrt(v);
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
      parent_id: number | null;
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
        c.parent_id                                 AS parent_id,
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
       AND (b.account_id IS NULL OR e.account_id = b.account_id)
       AND (${accountId ?? null}::int IS NULL OR e.account_id = ${accountId ?? null}::int)
      WHERE b.user_id = ${uid}
        AND b.period = ${period}
        AND (
          b.account_id IS NULL
          OR (${accountId ?? null}::int IS NULL AND b.account_id IS NOT NULL)
          OR b.account_id = ${accountId ?? null}::int
        )
      GROUP BY b.id, b.category_id, c.name, c.color, c.parent_id, b.monthly_limit, b.currency, b.period, b.account_id
      ORDER BY c.name ASC
    `);

    // When accountId IS provided, hide budgets scoped to OTHER accounts (SQL
    // above lets global rows and rows scoped to this account through; this
    // pass makes that intent explicit and defensive).
    const rowsFiltered = result.rows.filter((r) =>
      accountId == null ? true : r.account_id == null || r.account_id === accountId
    );

    // Fetch 6 completed periods of history in one query, grouped by budget row.
    // For monthly: 6 calendar months before periodStart. For yearly: 6 calendar
    // years before periodStart. Missing (userId, categoryId, periodKey) tuples
    // stay zero.
    const historyStart = period === 'monthly'
      ? new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() - 6, 1))
      : new Date(Date.UTC(periodStart.getUTCFullYear() - 6, 0, 1));

    const historyRes = await db.execute<{
      budget_id: number;
      category_id: number;
      period_key: string;      // 'YYYY-MM' or 'YYYY'
      spent: string;
    }>(sql`
      WITH ${TX_EFFECTIVE_CTE}
      SELECT
        b.id                                          AS budget_id,
        b.category_id,
        ${period === 'monthly'
          ? sql`to_char(e.date, 'YYYY-MM')`
          : sql`to_char(e.date, 'YYYY')`
        } AS period_key,
        COALESCE(-SUM(e.amount), 0)::text AS spent
      FROM category_budgets b
      JOIN tx_effective e
        ON (
          e.category_id = b.category_id
          OR e.category_id IN (
            SELECT cc.id FROM categories cc
            WHERE cc.parent_id = b.category_id AND cc.user_id = ${uid}
          )
        )
       AND e.user_id = ${uid}
       AND e.transfer_group_id IS NULL
       AND e.date >= ${historyStart.toISOString().slice(0, 10)}::date
       AND e.date <  ${startIso}::date
       AND (b.account_id IS NULL OR e.account_id = b.account_id)
       AND (${accountId ?? null}::int IS NULL OR e.account_id = ${accountId ?? null}::int)
      WHERE b.user_id = ${uid}
        AND b.period = ${period}
      GROUP BY b.id, b.category_id, period_key
    `);

    // Group history rows by budget-row id (not category_id) then by period_key.
    // A category can have both a GLOBAL and an ACCOUNT-SCOPED budget (Task 2),
    // so keying by category_id here would double-count: the outer /result
    // query already groups by b.id per row, so history must match that grain.
    const historyByBudget = new Map<number, Map<string, string>>();
    for (const r of historyRes.rows) {
      let inner = historyByBudget.get(r.budget_id);
      if (!inner) { inner = new Map(); historyByBudget.set(r.budget_id, inner); }
      inner.set(r.period_key, r.spent);
    }

    // Rows whose parent category is ALSO budgeted must be excluded from the
    // totals: the parent's rolled-up spend/limit already includes this row's,
    // so summing both double-counts it. This is the backend counterpart of
    // the frontend's client-side `topLevelRows` filter — both are kept
    // (defense-in-depth) so a future change to either side can't silently
    // reintroduce the double-count.
    const budgetedCategoryIds = new Set(rowsFiltered.map((r) => r.category_id));

    let totalLimit = 0;
    let totalSpent = 0;
    let totalProjected: number | null = 0;
    const rows = rowsFiltered.map((r) => {
      const limit = Number(r.limit);
      const spent = Number(r.spent);
      const projected = computeProjected(spent, elapsedDays, windowDays, periodEndExclusive, now);

      const includeInTotals = r.parent_id == null || !budgetedCategoryIds.has(r.parent_id);
      if (includeInTotals) {
        totalLimit += limit;
        totalSpent += spent;
        if (totalProjected !== null) {
          if (projected == null) totalProjected = null;
          else totalProjected += Number(projected);
        }
      }

      const priorKeys = priorPeriodKeys(period, periodStart);
      const catHist = historyByBudget.get(r.id) ?? new Map<string, string>();
      const historyValuesNum = priorKeys.map((k) => Number(catHist.get(k) ?? '0'));
      const nonZeroCount = historyValuesNum.filter((v) => v > 0).length;

      const history = nonZeroCount >= 2
        ? {
            values: historyValuesNum.map((v) => v.toFixed(2)),
            average: mean(historyValuesNum).toFixed(2),
            median: median(historyValuesNum).toFixed(2),
          }
        : null;

      // Gate on nonZeroCount (not historyValuesNum.length, which is always 6
      // due to zero-padding to a fixed 6-period window): stdev computed
      // against a mostly-zero-padded array is not a meaningful anomaly
      // signal, so we require >=3 real (non-zero) completed periods before
      // flagging. nonZeroCount >= 3 implies >= 2, so `history !== null` is
      // already satisfied; kept for readability.
      const anomaly = history !== null
        && nonZeroCount >= 3
        && Math.abs(spent - mean(historyValuesNum)) > stdev(historyValuesNum);

      const overCount = historyValuesNum.filter((v) => v > limit).length;
      const underHalfCount = limit > 0
        ? historyValuesNum.filter((v) => v < limit * 0.5).length
        : 0;
      // Gate on `history !== null` (>= 2 non-zero completed periods) so a
      // brand-new budget with an all-zero history never suggests "0.00" —
      // the frontend's guard is `!= null`, so a "0.00" suggestion would
      // render an "Ajuster à 0,00 €" button that the PUT positiveDecimal
      // guard rejects with a 400. Also clamp to > 0 defensively in case the
      // median itself rounds to zero even with qualifying history.
      const medianValue = median(historyValuesNum);
      const suggestedLimit = history !== null
        && medianValue > 0
        && (overCount >= 3 || underHalfCount >= 3)
        ? medianValue.toFixed(2)
        : null;

      return {
        id: r.id,
        categoryId: r.category_id,
        name: r.name,
        color: r.color,
        parentId: r.parent_id,
        accountId: r.account_id,
        period: r.period as 'monthly' | 'yearly',
        limit: r.limit,
        currency: r.currency,
        spent: spent.toFixed(2),
        remaining: (limit - spent).toFixed(2),
        pct: limit > 0 ? Math.round((spent / limit) * 100) : 0,
        over: spent > limit,
        projected,
        history,
        anomaly,
        suggestedLimit,
      };
    });

    const response: {
      period: 'monthly' | 'yearly';
      month?: string; year?: string;
      windowDays: number; elapsedDays: number;
      rows: typeof rows;
      totals: { limit: string; spent: string; remaining: string; projected: string | null };
      unbudgetedCandidates: Array<{
        categoryId: number;
        name: string;
        color: string | null;
        parentId: number | null;
        average: string;
      }>;
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
      unbudgetedCandidates: [],
    };
    if (monthOut) response.month = monthOut;
    if (yearOut) response.year = yearOut;

    // Unbudgeted candidates: expense categories with no active budget in the
    // current period AND positive average spend over the last 3 completed
    // periods (same period-type as the request). Reuses `budgetedCategoryIds`
    // computed above for the totals-double-count fix.
    const candidateHistoryStart = period === 'monthly'
      ? new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() - 3, 1))
      : new Date(Date.UTC(periodStart.getUTCFullYear() - 3, 0, 1));

    const candidateRes = await db.execute<{
      category_id: number;
      name: string;
      color: string | null;
      parent_id: number | null;
      average: string;
    }>(sql`
      WITH ${TX_EFFECTIVE_CTE},
      spend AS (
        SELECT
          e.category_id,
          ${period === 'monthly' ? sql`to_char(e.date, 'YYYY-MM')` : sql`to_char(e.date, 'YYYY')`} AS period_key,
          COALESCE(-SUM(e.amount), 0)::numeric AS spent
        FROM tx_effective e
        WHERE e.user_id = ${uid}
          AND e.transfer_group_id IS NULL
          AND e.date >= ${candidateHistoryStart.toISOString().slice(0, 10)}::date
          AND e.date <  ${startIso}::date
          AND (${accountId ?? null}::int IS NULL OR e.account_id = ${accountId ?? null}::int)
        GROUP BY e.category_id, period_key
      )
      SELECT
        c.id                                       AS category_id,
        c.name                                     AS name,
        c.color                                    AS color,
        c.parent_id                                AS parent_id,
        ROUND(AVG(s.spent)::numeric, 2)::text       AS average
      FROM categories c
      LEFT JOIN spend s ON s.category_id = c.id
      WHERE c.user_id = ${uid}
        AND c.kind = 'expense'
      GROUP BY c.id, c.name, c.color, c.parent_id
      HAVING COALESCE(AVG(s.spent), 0) > 0
      ORDER BY AVG(s.spent) DESC
      LIMIT 20
    `);

    response.unbudgetedCandidates = candidateRes.rows
      .filter((c) => !budgetedCategoryIds.has(c.category_id))
      .map((c) => ({
        categoryId: c.category_id,
        name: c.name,
        color: c.color,
        parentId: c.parent_id,
        average: c.average,
      }));

    return response;
  });
}
