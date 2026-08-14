import type { BalancePoint, TimeseriesConsolidatedPoint } from '../../api/types';

export interface SeriesPoint {
  date: string;
  value: number;
}

// The timeseries report's `consolidated.points` are already one-per-bucket
// and FX-converted server-side — nothing to forward-fill or filter, just
// reshape into the chart's plain {date, value} series.
export function buildConsolidatedSeries(points: TimeseriesConsolidatedPoint[]): SeriesPoint[] {
  return points.map((p) => ({ date: p.bucket, value: Number(p.total) }));
}

// Clip a full-history point set to a display window WITHOUT losing quiet
// accounts. A plain `bucket >= fromDate` filter drops every point of an
// account that hasn't moved inside the window, so buildAggregatedSeries
// carries 0 for it and the total sags by that account's whole balance —
// the same under-count the backend avoids by clipping AFTER its cumulative
// sum. For each account with pre-window history we inject a delta-0
// baseline point AT the window start holding its last known cumulative,
// unless the account already has a bucket exactly there.
export function withCarriedBaselines(
  points: BalancePoint[],
  fromDate: string | undefined,
): BalancePoint[] {
  if (!fromDate) return points;
  const out: BalancePoint[] = [];
  const lastBefore = new Map<number, BalancePoint>();
  const hasAtWindowStart = new Set<number>();
  for (const p of points) {
    if (p.bucket < fromDate) {
      const prev = lastBefore.get(p.account_id);
      if (!prev || p.bucket > prev.bucket) lastBefore.set(p.account_id, p);
    } else {
      out.push(p);
      if (p.bucket === fromDate) hasAtWindowStart.add(p.account_id);
    }
  }
  for (const [accId, p] of lastBefore) {
    if (hasAtWindowStart.has(accId)) continue;
    out.push({ ...p, bucket: fromDate, delta: '0' });
  }
  return out;
}

// /api/reports/timeseries returns one row per (account, date-bucket) only
// when that account had activity on that bucket. Naively summing per date
// skips accounts that didn't move on that day, dragging the multi-account
// total artificially toward zero. We forward-fill each account's last
// known `cumulative` so the sum at any date includes every account.
export function buildAggregatedSeries(points: BalancePoint[], currency: string): SeriesPoint[] {
  const filtered = points.filter(
    (p) => p.currency === currency && Number.isFinite(Number(p.cumulative)),
  );
  if (filtered.length === 0) return [];

  const allDates = Array.from(new Set(filtered.map((p) => p.bucket))).sort();
  const accountIds = Array.from(new Set(filtered.map((p) => p.account_id)));

  // Per-account, chronologically sorted points.
  const seriesByAccount = new Map<number, { bucket: string; cumulative: number }[]>();
  for (const accId of accountIds) {
    const rows = filtered
      .filter((p) => p.account_id === accId)
      .map((p) => ({ bucket: p.bucket, cumulative: Number(p.cumulative) }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));
    seriesByAccount.set(accId, rows);
  }

  // Walk the union of dates in order, advancing each account's pointer
  // through its own series and carrying its last seen cumulative forward.
  const pointers = new Map<number, number>(accountIds.map((id) => [id, 0]));
  const carries = new Map<number, number>(accountIds.map((id) => [id, 0]));

  const out: SeriesPoint[] = [];
  for (const date of allDates) {
    let total = 0;
    for (const accId of accountIds) {
      const series = seriesByAccount.get(accId)!;
      let ptr = pointers.get(accId)!;
      let carry = carries.get(accId)!;
      while (ptr < series.length && series[ptr]!.bucket <= date) {
        carry = series[ptr]!.cumulative;
        ptr++;
      }
      pointers.set(accId, ptr);
      carries.set(accId, carry);
      total += carry;
    }
    out.push({ date, value: total });
  }

  return out;
}
