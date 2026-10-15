import type { InvestmentsTimeseries } from '../../../../../../shared/api-contracts';
import { getState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';
import { ApiError } from '../../../apiError';
import { resolveRate } from '../../../../lib/fx';
import { addDaysIso, bucketFor, resolveDisplayCurrency, settingsDisplayCurrency, todayIso, txs } from './lib';

type Pt = { bucket: string; contributed: number; value: number; estimated: boolean };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Demo mirror of backend/src/domain/investments/series.ts for one account.
// Versé excludes income-kind transactions; an investment's gain is linearly
// interpolated between valuations (carried after the last, book before the
// first); savings = book. A bucket keeps its last day's numbers and is
// `estimated` only when that day is and no valuation landed in the bucket.
function accountSeries(
  acc: { id: number; type: string; openingDate: string; openingBalance: string },
  incomeIds: Set<number>,
  valuations: Array<{ date: string; value: number }>,
  from: string,
  to: string,
  granularity: 'day' | 'month',
): Pt[] {
  const book = new Map<string, number>();
  const contrib = new Map<string, number>();
  for (const t of txs()) {
    if (t.accountId !== acc.id || t.date < acc.openingDate) continue;
    const amt = Number(t.amount);
    book.set(t.date, (book.get(t.date) ?? 0) + amt);
    if (!(t.categoryId != null && incomeIds.has(t.categoryId))) contrib.set(t.date, (contrib.get(t.date) ?? 0) + amt);
  }
  const opening = Number(acc.openingBalance);
  let cumBook = opening;
  let cumContrib = opening;
  // Day-indexed running sums up to `to`, so anchors can read Versé at their date.
  const days: Array<{ date: string; book: number; contrib: number }> = [];
  for (let d = acc.openingDate; d <= to; d = addDaysIso(d, 1)) {
    cumBook += book.get(d) ?? 0;
    cumContrib += contrib.get(d) ?? 0;
    days.push({ date: d, book: cumBook, contrib: cumContrib });
  }
  const byDate = new Map(days.map((x) => [x.date, x]));
  const anchors = acc.type === 'investment'
    ? valuations
        .filter((v) => byDate.has(v.date))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((v) => ({ date: v.date, value: v.value, gain: v.value - byDate.get(v.date)!.contrib }))
    : [];
  const buckets = new Map<string, Pt & { anchor: boolean }>();
  for (const day of days) {
    if (day.date < from) continue;
    const prev = [...anchors].reverse().find((a) => a.date <= day.date);
    const next = anchors.find((a) => a.date > day.date);
    let value = day.book;
    let estimated = false;
    if (prev) {
      estimated = prev.date !== day.date;
      let gain = prev.gain;
      if (next) {
        const span = (Date.parse(next.date) - Date.parse(prev.date)) / 86_400_000;
        const at = (Date.parse(day.date) - Date.parse(prev.date)) / 86_400_000;
        gain += ((next.gain - prev.gain) * at) / span;
      }
      value = prev.date === day.date ? prev.value : day.contrib + gain;
    }
    const bucket = granularity === 'month' ? `${bucketFor(day.date, 'month')}-01` : day.date;
    const anchor = (buckets.get(bucket)?.anchor ?? false) || (prev?.date === day.date);
    buckets.set(bucket, { bucket, contributed: day.contrib, value, estimated, anchor });
  }
  return [...buckets.values()].map((b) => ({ ...b, estimated: b.estimated && !b.anchor }));
}

function handleInvestmentsTimeseries(req: DemoRequest): InvestmentsTimeseries {
  const state = getState();
  const today = todayIso();
  const granularity = req.query.granularity === 'month' ? 'month' : 'day';
  const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
  const scope = state.accounts.filter((a) => a.type === 'investment' || a.type === 'savings');
  if (accountId !== undefined) {
    const acc = state.accounts.find((a) => a.id === accountId);
    if (!acc) throw new ApiError('account not found', 404, { error: 'account not found' });
    if (!scope.includes(acc)) throw new ApiError('account must be investment or savings', 400, { error: 'account must be investment or savings' });
  }
  const resolved = resolveDisplayCurrency(req.query.display, req.query.display === undefined ? settingsDisplayCurrency(state) : null);
  if (resolved === 'invalid') throw new ApiError('invalid display currency', 400, { error: 'invalid display currency' });

  const incomeIds = new Set(state.categories.filter((c) => c.kind === 'income').map((c) => c.id));
  const to = req.query.toDate && req.query.toDate < today ? req.query.toDate : today;
  const per = new Map<string, { currency: string; bucket: string; contributed: number; value: number; estimated: boolean }>();
  for (const acc of scope.filter((a) => accountId === undefined || a.id === accountId)) {
    const vals = (state.accountValuations ?? []).filter((v) => v.accountId === acc.id).map((v) => ({ date: v.date, value: Number(v.value) }));
    const from = req.query.fromDate && req.query.fromDate > acc.openingDate ? req.query.fromDate : acc.openingDate;
    for (const p of accountSeries(acc, incomeIds, vals, from, to, granularity)) {
      const key = `${acc.currency}|${p.bucket}`;
      const e = per.get(key) ?? { currency: acc.currency, bucket: p.bucket, contributed: 0, value: 0, estimated: false };
      per.set(key, { ...e, contributed: e.contributed + p.contributed, value: e.value + p.value, estimated: e.estimated || p.estimated });
    }
  }
  const rows = [...per.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.bucket.localeCompare(b.bucket));
  const points = rows.map((r) => ({
    currency: r.currency,
    bucket: r.bucket,
    contributed: round2(r.contributed).toFixed(2),
    value: round2(r.value).toFixed(2),
    gain: round2(r.value - r.contributed).toFixed(2),
    estimated: r.estimated,
  }));
  if (resolved === null) return { points, consolidated: null };

  const cons = new Map<string, { contributed: number; value: number; estimated: boolean; unmapped: Set<string> }>();
  for (const r of rows) {
    const e = cons.get(r.bucket) ?? { contributed: 0, value: 0, estimated: false, unmapped: new Set<string>() };
    cons.set(r.bucket, e);
    const rate = resolveRate(state.fxRates ?? [], r.currency, resolved, r.bucket);
    if (rate === null) { e.unmapped.add(r.currency); continue; }
    e.contributed += r.contributed * rate;
    e.value += r.value * rate;
    e.estimated = e.estimated || r.estimated;
  }
  return {
    points,
    consolidated: {
      display: resolved,
      points: [...cons.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, e]) => ({
        bucket,
        contributed: round2(e.contributed).toFixed(2),
        value: round2(e.value).toFixed(2),
        gain: round2(e.value - e.contributed).toFixed(2),
        estimated: e.estimated,
        unmapped: [...e.unmapped].sort(),
      })),
    },
  };
}

export function registerInvestmentsReadHandlers(): void {
  registerHandler('GET', '/api/reports/investments-timeseries', handleInvestmentsTimeseries);
}
