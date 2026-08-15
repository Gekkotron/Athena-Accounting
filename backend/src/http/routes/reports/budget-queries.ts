import { sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { TX_EFFECTIVE_CTE } from './sql-fragments.js';

export type BudgetRow = {
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
};

export type BudgetHistoryRow = {
  budget_id: number;
  category_id: number;
  period_key: string;
  spent: string;
};

export type UnbudgetedCandidateRow = {
  category_id: number;
  name: string;
  color: string | null;
  parent_id: number | null;
  average: string;
};

// Rows: for each budget matching the period + account scope, its rolled-up
// spend inside the period. Global budgets (account_id IS NULL) always count;
// scoped budgets require accountId param equality (or no filter).
export async function fetchBudgetRows(
  uid: number,
  period: 'monthly' | 'yearly',
  startIso: string,
  endIso: string,
  accountId: number | null,
): Promise<BudgetRow[]> {
  const res = await db.execute<BudgetRow>(sql`
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
  return res.rows;
}

// 6 completed periods of history in one query, grouped by budget row.
// For monthly: 6 calendar months before periodStart. For yearly: 6 calendar
// years before periodStart. Missing (userId, categoryId, periodKey) tuples
// stay zero.
export async function fetchBudgetHistory(
  uid: number,
  period: 'monthly' | 'yearly',
  historyStartIso: string,
  startIso: string,
  accountId: number | null,
): Promise<BudgetHistoryRow[]> {
  const res = await db.execute<BudgetHistoryRow>(sql`
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
     AND e.date >= ${historyStartIso}::date
     AND e.date <  ${startIso}::date
     AND (b.account_id IS NULL OR e.account_id = b.account_id)
     AND (${accountId ?? null}::int IS NULL OR e.account_id = ${accountId ?? null}::int)
    WHERE b.user_id = ${uid}
      AND b.period = ${period}
    GROUP BY b.id, b.category_id, period_key
  `);
  return res.rows;
}

// Expense categories with positive average spend over the last 3 completed
// periods (same period-type as the request). Returned rows are unfiltered:
// caller removes categories that already have an active budget row.
export async function fetchUnbudgetedCandidates(
  uid: number,
  period: 'monthly' | 'yearly',
  candidateHistoryStartIso: string,
  startIso: string,
  accountId: number | null,
): Promise<UnbudgetedCandidateRow[]> {
  const res = await db.execute<UnbudgetedCandidateRow>(sql`
    WITH ${TX_EFFECTIVE_CTE},
    spend AS (
      SELECT
        e.category_id,
        ${period === 'monthly' ? sql`to_char(e.date, 'YYYY-MM')` : sql`to_char(e.date, 'YYYY')`} AS period_key,
        COALESCE(-SUM(e.amount), 0)::numeric AS spent
      FROM tx_effective e
      WHERE e.user_id = ${uid}
        AND e.transfer_group_id IS NULL
        AND e.date >= ${candidateHistoryStartIso}::date
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
  return res.rows;
}
