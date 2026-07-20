import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { userId } from '../../plugins/auth.js';

// List accounts with computed current balance + counts. Raw SQL here (same
// pattern as reports.ts) because Drizzle's column-reference interpolation
// across a correlated subquery turned out to silently miscorrelate — the
// inner WHERE never matched, and counts came back as 0 despite matching
// transactions existing in the DB. Explicit aliases (`a`, `t`) guarantee
// the correlation lines up.
//
// "available" vs "blocked" decomposition:
//   opening_balance is available iff account.lock_years is null OR
//     opening_date + lock_years years <= today.
//   each transaction is available iff:
//     - t.lock_years IS NOT NULL AND t.date + t.lock_years years <= today, OR
//     - t.lock_years IS NULL AND (a.lock_years IS NULL OR a.opening_date + a.lock_years years <= today).
//   blocked_balance = current_balance - available_balance.
export function registerList(app: FastifyInstance): void {
  app.get('/api/accounts', async (req) => {
    const uid = userId(req);
    const result = await db.execute<{
      id: number;
      name: string;
      type: string;
      currency: string;
      opening_balance: string;
      opening_date: string;
      display_order: number;
      created_at: Date;
      lock_years: number | null;
      current_balance: string;
      available_balance: string;
      transaction_count: number;
      counted_transaction_count: number;
    }>(sql`
      SELECT
        a.id,
        a.name,
        a.type,
        a.currency,
        a.opening_balance::text                                AS opening_balance,
        to_char(a.opening_date, 'YYYY-MM-DD')                  AS opening_date,
        a.display_order,
        a.created_at,
        a.lock_years                                           AS lock_years,
        (
          a.opening_balance + COALESCE(
            (SELECT SUM(t.amount) FROM transactions t
              WHERE t.account_id = a.id AND t.date >= a.opening_date),
            0
          )
        )::text                                                AS current_balance,
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
        )::text                                                AS available_balance,
        (SELECT COUNT(*)::int FROM transactions t
          WHERE t.account_id = a.id)                           AS transaction_count,
        (SELECT COUNT(*)::int FROM transactions t
          WHERE t.account_id = a.id AND t.date >= a.opening_date)
                                                               AS counted_transaction_count
      FROM accounts a
      WHERE a.user_id = ${uid}
      ORDER BY a.display_order ASC, a.name ASC
    `);

    const accounts = result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      currency: r.currency,
      openingBalance: r.opening_balance,
      openingDate: r.opening_date,
      displayOrder: r.display_order,
      createdAt: r.created_at,
      lockYears: r.lock_years,
      currentBalance: r.current_balance,
      availableBalance: r.available_balance,
      transactionCount: r.transaction_count,
      countedTransactionCount: r.counted_transaction_count,
    }));

    return { accounts };
  });
}
