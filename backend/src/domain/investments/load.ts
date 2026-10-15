import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import type { SeriesAccountInput } from './series.js';

const toCents = (s: string): number => Math.round(Number(s) * 100);

export type InvestmentSeriesInput = {
  id: number;
  currency: string;
  account: SeriesAccountInput;
};

type AccountRow = {
  id: number;
  currency: string;
  opening_date: string;
  opening_balance: string;
};

// Loads the inputs computeAccountSeries needs for the user's investment
// accounts that have at least one valuation dated on or before `today`.
// Savings accounts are excluded: their value equals the book balance, so
// they need no valuation-aware series. `contributed` excludes transactions
// categorised as income.
export async function loadInvestmentSeriesInputs(
  uid: number,
  opts: { today: string; accountId?: number },
): Promise<InvestmentSeriesInput[]> {
  const { today, accountId } = opts;
  const accounts = await db.execute<AccountRow>(sql`
    SELECT
      a.id,
      a.currency,
      to_char(a.opening_date, 'YYYY-MM-DD') AS opening_date,
      a.opening_balance::text AS opening_balance
    FROM accounts a
    WHERE a.user_id = ${uid}
      AND a.type = 'investment'
      ${accountId !== undefined ? sql`AND a.id = ${accountId}` : sql``}
      AND EXISTS (
        SELECT 1 FROM account_valuations v WHERE v.account_id = a.id AND v.date <= ${today}
      )
    ORDER BY a.id
  `);
  if (accounts.rows.length === 0) return [];
  const idList = sql.join(accounts.rows.map((a) => sql`${a.id}`), sql`, `);

  const txRows = await db.execute<{
    account_id: number;
    date: string;
    book: string;
    contributed: string;
  }>(sql`
    SELECT
      t.account_id,
      to_char(t.date, 'YYYY-MM-DD') AS date,
      SUM(t.amount)::text AS book,
      COALESCE(SUM(t.amount) FILTER (WHERE c.kind IS NULL OR c.kind <> 'income'), 0)::text AS contributed
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.account_id IN (${idList}) AND t.date >= a.opening_date
    GROUP BY t.account_id, t.date
  `);
  const valRows = await db.execute<{ account_id: number; date: string; value: string }>(sql`
    SELECT account_id, to_char(date, 'YYYY-MM-DD') AS date, value::text AS value
    FROM account_valuations
    WHERE account_id IN (${idList}) AND date <= ${today}
  `);

  const deltas = new Map<number, SeriesAccountInput['dailyDeltas']>();
  for (const r of txRows.rows) {
    const list = deltas.get(r.account_id) ?? [];
    list.push({ date: r.date, bookCents: toCents(r.book), contributedCents: toCents(r.contributed) });
    deltas.set(r.account_id, list);
  }
  const vals = new Map<number, SeriesAccountInput['valuations']>();
  for (const r of valRows.rows) {
    const list = vals.get(r.account_id) ?? [];
    list.push({ date: r.date, valueCents: toCents(r.value) });
    vals.set(r.account_id, list);
  }

  return accounts.rows.map((a) => ({
    id: a.id,
    currency: a.currency,
    account: {
      currency: a.currency,
      type: 'investment',
      openingDate: a.opening_date,
      openingCents: toCents(a.opening_balance),
      dailyDeltas: deltas.get(a.id) ?? [],
      valuations: vals.get(a.id) ?? [],
    },
  }));
}
