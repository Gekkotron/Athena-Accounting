import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { userId } from '../../plugins/auth.js';
import { loadUserRates } from '../../../domain/fx/rates-repo.js';
import { consolidate } from '../../../domain/fx/consolidate.js';
import { loadUserDisplayCurrency } from '../../../domain/settings/loader.js';
import type { FxRate } from '../../../domain/fx/types.js';
import { todayLocalIso } from '../../../lib/dates.js';

type PerCurrencyRow = {
  currency: string;
  total: string;
  available: string;
  invested: string;
  // Σ Gain (Valeur − Versé) over investment + savings accounts.
  unrealized: string;
  account_count: number;
};

type ConsolidatedBlock = {
  display: string;
  total: string;
  available: string;
  invested: string;
  unrealized: string;
  unmapped: PerCurrencyRow[];
};

const CONSOLIDATE_KEYS = ['total', 'available', 'invested', 'unrealized'] as const;

// Resolves the effective display currency from the `?display=` query param,
// falling back to the caller-supplied settings value when the param is
// absent. Returns `null` for per-currency mode (no conversion), or
// `'invalid'` when the param is present but neither `none` nor a 3-letter
// uppercase code.
export function resolveDisplayCurrency(
  displayParam: string | undefined,
  settingsDisplay: string | null,
): string | null | 'invalid' {
  if (displayParam === undefined) return settingsDisplay;
  if (displayParam === 'none') return null;
  if (/^[A-Z]{3}$/.test(displayParam)) return displayParam;
  return 'invalid';
}

// Builds the `consolidated` response block for an already-resolved display
// currency — the shared shaping between the per-currency rows, the FX
// consolidation, and the response envelope.
export function buildConsolidatedBlock(
  perCurrencyRows: PerCurrencyRow[],
  display: string,
  rates: FxRate[],
  at: string,
): ConsolidatedBlock {
  const out = consolidate(perCurrencyRows, display, rates, at, CONSOLIDATE_KEYS);
  return {
    display: out.display,
    total: out.totals.total,
    available: out.totals.available,
    invested: out.totals.invested,
    unrealized: out.totals.unrealized,
    // consolidate() pushes back the exact row objects it received for any
    // currency it couldn't map — its generic signature only names the
    // `{ currency } & Record<K, string>` fields it operates on, but each
    // element is still the original PerCurrencyRow (account_count included).
    unmapped: out.unmapped as PerCurrencyRow[],
  };
}

export function registerBalanceRoute(app: FastifyInstance): void {
  // Total balance grouped by currency. Multi-currency accounts are returned
  // separately (no auto-conversion), plus an optional `consolidated` block
  // converted into a single display currency via the manual FX table.
  app.get('/api/reports/balance', async (req, reply) => {
    const uid = userId(req);
    // available = balance not locked by lock_years (Disponible + Placé combined).
    // invested = the subset of `available` that lives in an account whose type
    // is 'investment'. Client computes: disponible = available - invested;
    // bloqué = total - available.
    //
    // Investment accounts with a valuation use Valeur (latest valuation) in
    // place of the book balance: adjustment = Valeur - book. While the
    // account-level lock is active the adjustment only lifts `total`
    // (→ Bloqué); otherwise it also lifts `available` and so `invested`
    // (→ Placé). unrealized = Valeur - Versé for investment/savings accounts,
    // where Versé excludes income-kind transactions.
    const rows = await db.execute<PerCurrencyRow>(sql`
      WITH base AS (
        SELECT
          a.id,
          a.currency,
          a.type,
          (
            a.opening_balance + COALESCE(
              (SELECT SUM(t.amount) FROM transactions t
                WHERE t.account_id = a.id AND t.date >= a.opening_date),
              0
            )
          ) AS book,
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
          ) AS available_book,
          (
            a.lock_years IS NOT NULL
            AND (a.opening_date + (INTERVAL '1 year' * a.lock_years))::date > CURRENT_DATE
          ) AS account_locked,
          CASE WHEN a.type IN ('investment', 'savings') THEN
            a.opening_balance + COALESCE(
              (SELECT SUM(t.amount) FROM transactions t
                LEFT JOIN categories c ON c.id = t.category_id
                WHERE t.account_id = a.id AND t.date >= a.opening_date
                  AND (c.kind IS NULL OR c.kind <> 'income')),
              0
            )
          END AS contributed,
          CASE WHEN a.type = 'investment' THEN
            (SELECT v.value FROM account_valuations v
              WHERE v.account_id = a.id AND v.date <= CURRENT_DATE
              ORDER BY v.date DESC LIMIT 1)
          END AS latest_value
        FROM accounts a
        WHERE a.user_id = ${uid}
      ),
      per_account AS (
        SELECT
          currency,
          type,
          book + COALESCE(latest_value - book, 0) AS total,
          available_book + CASE WHEN account_locked THEN 0 ELSE COALESCE(latest_value - book, 0) END AS available,
          CASE WHEN contributed IS NULL THEN 0
               ELSE COALESCE(latest_value, book) - contributed END AS unrealized
        FROM base
      )
      SELECT
        currency,
        SUM(total)::text AS total,
        SUM(available)::text AS available,
        SUM(CASE WHEN type = 'investment' THEN available ELSE 0 END)::text AS invested,
        SUM(unrealized)::text AS unrealized,
        COUNT(*)::int AS account_count
      FROM per_account
      GROUP BY currency
      ORDER BY currency
    `);

    const q = req.query as { display?: string } | undefined;
    const displayParam = q?.display;
    const settingsDisplay = displayParam === undefined ? await loadUserDisplayCurrency(uid) : null;
    const resolved = resolveDisplayCurrency(displayParam, settingsDisplay);
    if (resolved === 'invalid') {
      return reply.code(400).send({ error: 'invalid display currency' });
    }

    let consolidated: ConsolidatedBlock | null = null;
    if (resolved !== null) {
      const rates = await loadUserRates(uid);
      const today = todayLocalIso();
      consolidated = buildConsolidatedBlock(rows.rows, resolved, rates, today);
    }

    return { perCurrency: rows.rows, consolidated };
  });
}
