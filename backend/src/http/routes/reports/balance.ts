import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { userId } from '../../plugins/auth.js';

export function registerBalanceRoute(app: FastifyInstance): void {
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
}
