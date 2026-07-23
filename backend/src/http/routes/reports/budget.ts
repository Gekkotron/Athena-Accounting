import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { userId } from '../../plugins/auth.js';
import { BudgetQuery } from './schemas.js';
import { TX_EFFECTIVE_CTE } from './sql-fragments.js';
import { annotateBudgetRow, elapsedIn, priorPeriodKeys } from './period-math.js';

export function registerBudgetRoute(app: FastifyInstance): void {
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

    // Resolve the period bounds and windowDays/elapsedDays. Default period
    // uses UTC components so it agrees with elapsedIn's UTC comparison —
    // otherwise, for local timezones ahead of UTC (Europe/Paris, etc.),
    // the first hour or two of the new month reports the *previous* server-
    // local month as the default while elapsedIn keys off the new UTC one,
    // producing elapsedDays=0 for the returned month.
    const now = new Date();
    const [periodStart, periodEndExclusive, windowDays, elapsedDays, monthOut, yearOut] =
      (() => {
        if (period === 'monthly') {
          const m = parsed.data.month
            ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
          const [y, mm] = m.split('-').map(Number);
          const start = new Date(Date.UTC(y!, mm! - 1, 1));
          const end = new Date(Date.UTC(y!, mm!, 1));
          const wDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
          const eDays = elapsedIn(start, end, now);
          return [start, end, wDays, eDays, m, undefined] as const;
        } else {
          const y = parsed.data.year ?? String(now.getUTCFullYear());
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

      const priorKeys = priorPeriodKeys(period, periodStart);
      const catHist = historyByBudget.get(r.id) ?? new Map<string, string>();
      const historyValuesNum = priorKeys.map((k) => Number(catHist.get(k) ?? '0'));

      const annotated = annotateBudgetRow({
        spent, limit, elapsedDays, windowDays, periodEndExclusive, now, historyValuesNum,
      });

      const includeInTotals = r.parent_id == null || !budgetedCategoryIds.has(r.parent_id);
      if (includeInTotals) {
        totalLimit += limit;
        totalSpent += spent;
        if (totalProjected !== null) {
          if (annotated.projected == null) totalProjected = null;
          else totalProjected += Number(annotated.projected);
        }
      }

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
        projected: annotated.projected,
        history: annotated.history,
        anomaly: annotated.anomaly,
        suggestedLimit: annotated.suggestedLimit,
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
