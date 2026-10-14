// Versé / Valeur / Gain time series for investment and savings accounts.
//
// Pure computation: callers load accounts, per-day transaction sums and
// valuations, and get back bucketed points. Money is handled as integer
// cents internally.
//
// Per account and day t:
//   versé(t) = opening balance + Σ non-income transactions up to t
//   book(t)  = opening balance + Σ all transactions up to t
// Savings accounts, and investment accounts before their first valuation,
// have value(t) = book(t). Once an investment account has valuations, each
// valuation date is an anchor with gain_i = V_i - versé(d_i). The gain is
// linearly interpolated by day between anchors and carried after the last
// one, and value(t) = versé(t) + gain(t), so a deposit between two
// valuations raises the value immediately.

import { resolveRate } from '../fx/resolve-rate.js';
import type { FxRate } from '../fx/types.js';

export type SeriesGranularity = 'day' | 'month';

export type SeriesAccountInput = {
  currency: string;
  type: 'investment' | 'savings';
  openingDate: string;
  openingCents: number;
  // Per-day transaction sums: `bookCents` over all transactions of the day,
  // `contributedCents` over those not categorised as income.
  dailyDeltas: Array<{ date: string; bookCents: number; contributedCents: number }>;
  valuations: Array<{ date: string; valueCents: number }>;
};

export type SeriesRange = {
  fromDate: string;
  toDate: string;
  today: string;
  granularity: SeriesGranularity;
};

export type AccountPoint = {
  bucket: string;
  contributedCents: number;
  valueCents: number;
  estimated: boolean;
};

export type CurrencyPoint = {
  currency: string;
  bucket: string;
  contributed: string;
  value: string;
  gain: string;
  estimated: boolean;
};

export type ConsolidatedPoint = {
  bucket: string;
  contributed: string;
  value: string;
  gain: string;
  estimated: boolean;
  unmapped: string[];
};

const DAY_MS = 86_400_000;

export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / DAY_MS);
}

export function isoOfDay(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function bucketOf(iso: string, granularity: SeriesGranularity): string {
  return granularity === 'month' ? `${iso.slice(0, 7)}-01` : iso;
}

export function formatCents(c: number): string {
  return (c / 100).toFixed(2);
}

type Step = { days: number[]; cum: number[] };

function buildStep(events: Array<{ day: number; delta: number }>): Step {
  const sorted = [...events].sort((a, b) => a.day - b.day);
  const days: number[] = [];
  const cum: number[] = [];
  let running = 0;
  for (const e of sorted) {
    running += e.delta;
    if (days.length > 0 && days[days.length - 1] === e.day) {
      cum[cum.length - 1] = running;
    } else {
      days.push(e.day);
      cum.push(running);
    }
  }
  return { days, cum };
}

// Cumulative sum at `day` (0 before the first event).
function stepAt(step: Step, day: number): number {
  let lo = 0;
  let hi = step.days.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (step.days[mid]! <= day) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found === -1 ? 0 : step.cum[found]!;
}

type Anchor = { day: number; valueCents: number; gainCents: number };

export function computeAccountSeries(
  account: SeriesAccountInput,
  range: SeriesRange,
): AccountPoint[] {
  const openingDay = dayNumber(account.openingDate);
  const contribEvents = [{ day: openingDay, delta: account.openingCents }];
  const bookEvents = [{ day: openingDay, delta: account.openingCents }];
  for (const d of account.dailyDeltas) {
    const day = dayNumber(d.date);
    if (day < openingDay) continue;
    contribEvents.push({ day, delta: d.contributedCents });
    bookEvents.push({ day, delta: d.bookCents });
  }
  const contribStep = buildStep(contribEvents);
  const bookStep = buildStep(bookEvents);

  const todayDay = dayNumber(range.today);
  const anchors: Anchor[] = [];
  if (account.type === 'investment') {
    const byDay = new Map<number, number>();
    for (const v of account.valuations) {
      const day = dayNumber(v.date);
      if (day <= todayDay) byDay.set(day, v.valueCents);
    }
    for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
      const valueCents = byDay.get(day)!;
      anchors.push({ day, valueCents, gainCents: valueCents - stepAt(contribStep, day) });
    }
  }

  const start = Math.max(openingDay, dayNumber(range.fromDate));
  const end = Math.min(dayNumber(range.toDate), todayDay);
  const buckets = new Map<string, { point: AccountPoint; anchorInBucket: boolean }>();
  let j = -1;
  while (j + 1 < anchors.length && anchors[j + 1]!.day <= start) j++;

  for (let day = start; day <= end; day++) {
    while (j + 1 < anchors.length && anchors[j + 1]!.day <= day) j++;
    const contributed = stepAt(contribStep, day);
    let value: number;
    let estimated: boolean;
    let isAnchor = false;
    if (j === -1) {
      value = stepAt(bookStep, day);
      estimated = false;
    } else {
      const a = anchors[j]!;
      if (a.day === day) {
        value = a.valueCents;
        estimated = false;
        isAnchor = true;
      } else {
        const next = anchors[j + 1];
        let gain = a.gainCents;
        if (next) {
          gain = a.gainCents + ((next.gainCents - a.gainCents) * (day - a.day)) / (next.day - a.day);
        }
        value = Math.round(contributed + gain);
        estimated = true;
      }
    }
    const bucket = bucketOf(isoOfDay(day), range.granularity);
    const prev = buckets.get(bucket);
    buckets.set(bucket, {
      point: { bucket, contributedCents: contributed, valueCents: value, estimated },
      anchorInBucket: (prev?.anchorInBucket ?? false) || isAnchor,
    });
  }

  return [...buckets.values()]
    .map(({ point, anchorInBucket }) => ({
      ...point,
      estimated: point.estimated && !anchorInBucket,
    }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

// Sums account series into one series per (currency, bucket).
export function aggregateByCurrency(
  series: Array<{ currency: string; points: AccountPoint[] }>,
): CurrencyPoint[] {
  const map = new Map<
    string,
    { currency: string; bucket: string; contributed: number; value: number; estimated: boolean }
  >();
  for (const s of series) {
    for (const p of s.points) {
      const key = `${s.currency}|${p.bucket}`;
      const e = map.get(key) ?? {
        currency: s.currency,
        bucket: p.bucket,
        contributed: 0,
        value: 0,
        estimated: false,
      };
      e.contributed += p.contributedCents;
      e.value += p.valueCents;
      e.estimated = e.estimated || p.estimated;
      map.set(key, e);
    }
  }
  return [...map.values()]
    .sort((a, b) => a.currency.localeCompare(b.currency) || a.bucket.localeCompare(b.bucket))
    .map((e) => ({
      currency: e.currency,
      bucket: e.bucket,
      contributed: formatCents(e.contributed),
      value: formatCents(e.value),
      gain: formatCents(e.value - e.contributed),
      estimated: e.estimated,
    }));
}

// Converts per-currency points into one display currency, per bucket. A
// currency with no rate at the bucket date is listed in `unmapped` and left
// out of the sums.
export function consolidatePoints(
  points: CurrencyPoint[],
  display: string,
  rates: FxRate[],
): ConsolidatedPoint[] {
  const map = new Map<
    string,
    { contributed: number; value: number; estimated: boolean; unmapped: Set<string> }
  >();
  for (const p of points) {
    const e = map.get(p.bucket) ?? {
      contributed: 0,
      value: 0,
      estimated: false,
      unmapped: new Set<string>(),
    };
    map.set(p.bucket, e);
    const rate = resolveRate(rates, p.currency, display, p.bucket);
    if (rate === null) {
      e.unmapped.add(p.currency);
      continue;
    }
    e.contributed += Number(p.contributed) * rate;
    e.value += Number(p.value) * rate;
    e.estimated = e.estimated || p.estimated;
  }
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, e]) => {
      const contributed = round2(e.contributed);
      const value = round2(e.value);
      return {
        bucket,
        contributed: contributed.toFixed(2),
        value: value.toFixed(2),
        gain: round2(value - contributed).toFixed(2),
        estimated: e.estimated,
        unmapped: [...e.unmapped].sort(),
      };
    });
}
