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
  month: z.string().regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM').optional(),
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

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  // Total balance grouped by currency. Multi-currency accounts are returned
  // separately (no auto-conversion).
  app.get('/api/reports/balance', async (req) => {
    const uid = userId(req);
    const rows = await db.execute<{
      currency: string;
      total: string;
      available: string;
      account_count: number;
    }>(sql`
      SELECT
        a.currency,
        SUM(
          a.opening_balance + COALESCE(
            (SELECT SUM(t.amount) FROM transactions t
             WHERE t.account_id = a.id AND t.date >= a.opening_date),
            0
          )
        )::text AS total,
        SUM(
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
        )::text AS available,
        COUNT(*)::int AS account_count
      FROM accounts a
      WHERE a.user_id = ${uid}
      GROUP BY a.currency
      ORDER BY a.currency
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

  // Planned-vs-actual per budgeted expense category for one calendar month.
  // Reuses the tx_effective CTE from /api/reports/categories so splits count
  // per split-category and internal transfers are excluded. Only categories
  // that have a budget row appear. spent = -SUM(amount) (expenses are stored
  // negative); a budgeted category with no spend that month returns "0.00".
  app.get('/api/reports/budget', async (req, reply) => {
    const uid = userId(req);
    const parsed = BudgetQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const month = parsed.data.month ?? new Date().toISOString().slice(0, 7);

    const result = await db.execute<{
      category_id: number;
      name: string;
      color: string | null;
      limit: string;
      currency: string;
      spent: string;
    }>(sql`
      WITH ${TX_EFFECTIVE_CTE}
      SELECT
        b.category_id                              AS category_id,
        c.name                                     AS name,
        c.color                                    AS color,
        b.monthly_limit::text                      AS limit,
        b.currency                                 AS currency,
        COALESCE(-SUM(e.amount), 0)::text          AS spent
      FROM category_budgets b
      JOIN categories c ON c.id = b.category_id AND c.user_id = ${uid}
      LEFT JOIN tx_effective e
        ON e.category_id = b.category_id
       AND e.user_id = ${uid}
       AND e.transfer_group_id IS NULL
       AND to_char(date_trunc('month', e.date::timestamp), 'YYYY-MM') = ${month}
      WHERE b.user_id = ${uid}
      GROUP BY b.category_id, c.name, c.color, b.monthly_limit, b.currency
      ORDER BY c.name ASC
    `);

    let totalLimit = 0;
    let totalSpent = 0;
    const rows = result.rows.map((r) => {
      const limit = Number(r.limit);
      const spent = Number(r.spent);
      totalLimit += limit;
      totalSpent += spent;
      return {
        categoryId: r.category_id,
        name: r.name,
        color: r.color,
        limit: r.limit,
        currency: r.currency,
        spent: spent.toFixed(2),
        remaining: (limit - spent).toFixed(2),
        pct: limit > 0 ? Math.round((spent / limit) * 100) : 0,
        over: spent > limit,
      };
    });

    return {
      month,
      rows,
      totals: { limit: totalLimit.toFixed(2), spent: totalSpent.toFixed(2) },
    };
  });
}
