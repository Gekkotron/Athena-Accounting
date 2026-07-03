import type { BalancePoint } from '../../api/types';

export interface SeriesPoint {
  date: string;
  value: number;
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
