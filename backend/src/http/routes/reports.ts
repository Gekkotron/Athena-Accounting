import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { userId } from '../plugins/auth.js';

const RangeQuery = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  granularity: z.enum(['day', 'month']).default('day'),
});

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
    const { fromDate, toDate } = parsed.data;

    const rows = await db.execute<{
      category_id: number | null;
      category_name: string | null;
      category_kind: string | null;
      category_is_internal_transfer: boolean | null;
      month: string;
      total: string;
      transaction_count: number;
    }>(sql`
      SELECT
        c.id AS category_id,
        c.name AS category_name,
        c.kind AS category_kind,
        c.is_internal_transfer AS category_is_internal_transfer,
        to_char(date_trunc('month', t.date::timestamp), 'YYYY-MM') AS month,
        SUM(t.amount)::text AS total,
        COUNT(*)::int AS transaction_count
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ${uid}
        AND t.transfer_group_id IS NULL
        ${fromDate ? sql`AND t.date >= ${fromDate}` : sql``}
        ${toDate ? sql`AND t.date <= ${toDate}` : sql``}
      GROUP BY c.id, c.name, c.kind, month
      ORDER BY month DESC, total ASC
    `);

    return { rows: rows.rows };
  });
}
