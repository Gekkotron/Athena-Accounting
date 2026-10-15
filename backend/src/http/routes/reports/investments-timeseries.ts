import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { userId } from '../../plugins/auth.js';
import { RangeQuery } from './schemas.js';
import { loadUserRates } from '../../../domain/fx/rates-repo.js';
import { loadUserDisplayCurrency } from '../../../domain/settings/loader.js';
import { todayLocalIso } from '../../../lib/dates.js';
import { resolveDisplayCurrency } from './balance.js';
import {
  aggregateByCurrency,
  computeAccountSeries,
  consolidatePoints,
  type SeriesAccountInput,
} from '../../../domain/investments/series.js';

const toCents = (s: string): number => Math.round(Number(s) * 100);

type AccountRow = {
  id: number;
  currency: string;
  type: 'investment' | 'savings';
  opening_date: string;
  opening_balance: string;
};

export function registerInvestmentsTimeseriesRoute(app: FastifyInstance): void {
  // Versé / Valeur / Gain per bucket for investment and savings accounts.
  // Between valuations the value is interpolated, so points can be flagged
  // `estimated`. Response mirrors /api/reports/timeseries: flat per-currency
  // `points` plus an optional `consolidated` block in the display currency.
  app.get('/api/reports/investments-timeseries', async (req, reply) => {
    const uid = userId(req);
    const parsed = RangeQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const { fromDate, toDate, granularity, accountId } = parsed.data;

    const q = req.query as { display?: string } | undefined;
    const displayParam = q?.display;
    const settingsDisplay = displayParam === undefined ? await loadUserDisplayCurrency(uid) : null;
    const resolved = resolveDisplayCurrency(displayParam, settingsDisplay);
    if (resolved === 'invalid') {
      return reply.code(400).send({ error: 'invalid display currency' });
    }

    if (accountId !== undefined) {
      const owned = await db.execute<{ type: string }>(
        sql`SELECT type FROM accounts WHERE id = ${accountId} AND user_id = ${uid}`,
      );
      if (owned.rows.length === 0) return reply.code(404).send({ error: 'account not found' });
      if (owned.rows[0]!.type !== 'investment' && owned.rows[0]!.type !== 'savings') {
        return reply.code(400).send({ error: 'account must be investment or savings' });
      }
    }

    const accounts = await db.execute<AccountRow>(sql`
      SELECT
        a.id,
        a.currency,
        a.type,
        to_char(a.opening_date, 'YYYY-MM-DD') AS opening_date,
        a.opening_balance::text AS opening_balance
      FROM accounts a
      WHERE a.user_id = ${uid}
        AND a.type IN ('investment', 'savings')
        ${accountId !== undefined ? sql`AND a.id = ${accountId}` : sql``}
      ORDER BY a.id
    `);
    if (accounts.rows.length === 0) {
      return { points: [], consolidated: resolved === null ? null : { display: resolved, points: [] } };
    }
    const ids = accounts.rows.map((a) => a.id);
    const idList = sql.join(ids.map((i) => sql`${i}`), sql`, `);
    const today = todayLocalIso();

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

    const inputs = accounts.rows.map((a) => ({
      currency: a.currency,
      account: {
        currency: a.currency,
        type: a.type,
        openingDate: a.opening_date,
        openingCents: toCents(a.opening_balance),
        dailyDeltas: deltas.get(a.id) ?? [],
        valuations: vals.get(a.id) ?? [],
      } satisfies SeriesAccountInput,
    }));
    const earliestOpening = inputs.map((i) => i.account.openingDate).sort()[0]!;
    const range = {
      fromDate: fromDate ?? earliestOpening,
      toDate: toDate ?? today,
      today,
      granularity,
    };

    const series = inputs.map((i) => ({
      currency: i.currency,
      points: computeAccountSeries(i.account, range),
    }));
    const points = aggregateByCurrency(series);

    let consolidated: { display: string; points: ReturnType<typeof consolidatePoints> } | null = null;
    if (resolved !== null) {
      const rates = await loadUserRates(uid);
      consolidated = { display: resolved, points: consolidatePoints(points, resolved, rates) };
    }
    return { points, consolidated };
  });
}
