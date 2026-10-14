import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { userId } from '../../plugins/auth.js';
import { computeValuation } from '../../../domain/investments/gain.js';

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
//
// Valuation fields: `contributed` (Versé) is opening_balance plus every
// transaction since opening_date except income-kind categories, for
// investment/savings accounts only. `latest_value`/`latest_value_date` come
// from the newest account_valuations row at or before today. Valeur and gain
// are derived in domain/investments/gain.ts.
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
      closed_at: string | null;
      current_balance: string;
      available_balance: string;
      transaction_count: number;
      counted_transaction_count: number;
      iban: string | null;
      iban_locked: boolean;
      contributed: string | null;
      latest_value: string | null;
      latest_value_date: string | null;
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
        to_char(a.closed_at, 'YYYY-MM-DD')                     AS closed_at,
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
                                                               AS counted_transaction_count,
        -- IBAN: synced value wins over the manual accounts.iban. The schema
        -- allows several bca rows per account (no uniqueness on account_id),
        -- so MAX() + NULLIF keep this deterministic. iban_locked tracks
        -- whether a synced IBAN exists at all — the frontend uses it to
        -- disable manual editing (and the PUT route refuses the update).
        COALESCE(
          (SELECT MAX(NULLIF(bca.iban, ''))
             FROM bank_connection_accounts bca
            WHERE bca.account_id = a.id),
          a.iban
        )                                                      AS iban,
        EXISTS (
          SELECT 1 FROM bank_connection_accounts bca
          WHERE bca.account_id = a.id
            AND bca.iban IS NOT NULL
            AND bca.iban <> ''
        )                                                      AS iban_locked,
        CASE WHEN a.type IN ('investment', 'savings') THEN
          (
            a.opening_balance + COALESCE(
              (SELECT SUM(t.amount) FROM transactions t
                LEFT JOIN categories c ON c.id = t.category_id
                WHERE t.account_id = a.id AND t.date >= a.opening_date
                  AND (c.kind IS NULL OR c.kind <> 'income')),
              0
            )
          )::text
        END                                                    AS contributed,
        lv.value::text                                         AS latest_value,
        to_char(lv.date, 'YYYY-MM-DD')                         AS latest_value_date
      FROM accounts a
      LEFT JOIN LATERAL (
        SELECT v.value, v.date
          FROM account_valuations v
         WHERE v.account_id = a.id AND v.date <= CURRENT_DATE
         ORDER BY v.date DESC
         LIMIT 1
      ) lv ON TRUE
      WHERE a.user_id = ${uid}
      ORDER BY a.display_order ASC, a.name ASC
    `);

    const accounts = result.rows.map((r) => {
      const v = computeValuation({
        type: r.type,
        currentBalance: r.current_balance,
        contributed: r.contributed,
        latestValue: r.latest_value,
      });
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        currency: r.currency,
        openingBalance: r.opening_balance,
        openingDate: r.opening_date,
        displayOrder: r.display_order,
        createdAt: r.created_at,
        lockYears: r.lock_years,
        closedAt: r.closed_at,
        currentBalance: r.current_balance,
        availableBalance: r.available_balance,
        transactionCount: r.transaction_count,
        countedTransactionCount: r.counted_transaction_count,
        iban: r.iban,
        ibanLocked: r.iban_locked,
        contributed: r.contributed,
        latestValue: r.latest_value,
        latestValueDate: r.latest_value_date,
        value: v.value,
        gain: v.gain,
        gainPct: v.gainPct,
      };
    });

    return { accounts };
  });
}
