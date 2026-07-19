// Pure balance projection driven by active recurring series. No React,
// no fetch — takes a starting balance + a set of series and returns a
// daily-sampled forward trajectory. Callers plug it into the Récurrent
// Prévision tab and the Dashboard Trend chart overlay.

import type { RecurringSeries } from '../api/types';

export interface ForecastPoint {
  date: string; // YYYY-MM-DD
  projectedBalance: number;
  // Which series contributed on this day (empty on quiet days). Kept
  // even for daily samples with no activity so consumers can render a
  // tooltip's "what happened today" list uniformly.
  contributions: Array<{ seriesId: number; amount: number }>;
}

export interface ProjectBalanceOptions {
  startBalance: number;
  series: RecurringSeries[];
  horizonDays: number;
  startDate: string; // YYYY-MM-DD
}

// UTC-safe ISO day arithmetic — matches the backend + UpcomingTab.
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// Walk `lastSeen` forward in cadence-day steps until the returned date
// is strictly ≥ startDate. Mirrors backend/routes/recurring.ts.
function firstOccurrenceOnOrAfter(
  lastSeen: string,
  cadenceDays: number,
  startDate: string,
): string | null {
  if (cadenceDays <= 0) return null;
  let next = lastSeen;
  for (let i = 0; i < 5000; i++) {
    if (next >= startDate) return next;
    next = addDaysIso(next, cadenceDays);
  }
  return null;
}

export function projectBalance(opts: ProjectBalanceOptions): ForecastPoint[] {
  const { startBalance, series, horizonDays, startDate } = opts;
  if (horizonDays <= 0) return [];

  // Only active series contribute. Dismissed ones stay out of the
  // projection even if their pattern still holds.
  const active = series.filter((s) => s.status !== 'dismissed');

  // Build a map of `date → contributions` from each series' occurrences
  // over the horizon window. Series with cadence gaps larger than the
  // horizon may contribute zero or one point; short-cadence ones (weekly)
  // contribute many.
  const perDay = new Map<string, Array<{ seriesId: number; amount: number }>>();
  for (const s of active) {
    const first = firstOccurrenceOnOrAfter(s.lastSeenAt, s.cadenceDays, startDate);
    if (!first) continue;
    let cursor = first;
    // Guard against runaway loops with a per-series cap ~ horizon days.
    for (let step = 0; step <= horizonDays + 1; step++) {
      if (cursor > addDaysIso(startDate, horizonDays)) break;
      const list = perDay.get(cursor) ?? [];
      list.push({ seriesId: s.id, amount: Number(s.avgAmount) });
      perDay.set(cursor, list);
      cursor = addDaysIso(cursor, s.cadenceDays);
    }
  }

  // Walk day-by-day from startDate through startDate + horizonDays,
  // accumulating contributions into a running balance and emitting one
  // ForecastPoint per day.
  const out: ForecastPoint[] = [];
  let running = startBalance;
  for (let i = 0; i <= horizonDays; i++) {
    const date = addDaysIso(startDate, i);
    const contributions = perDay.get(date) ?? [];
    for (const c of contributions) running += c.amount;
    out.push({ date, projectedBalance: running, contributions });
  }
  return out;
}
