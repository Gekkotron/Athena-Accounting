import type { AccountPoint } from './series.js';

export type TimeseriesRow = {
  account_id: number;
  currency: string;
  bucket: string;
  delta: string;
  cumulative: string;
};

export type GainSeries = {
  accountId: number;
  currency: string;
  points: AccountPoint[];
};

const fmt = (cents: number): string => (cents / 100).toFixed(2);

// Replaces the SQL rows of each account in `series` with one row per
// computed bucket, where `cumulative` is the account's value (Valeur). The
// SQL only emits rows on buckets with transactions and the client
// forward-fills, so the dense rows are what make interpolated gains
// visible. Buckets are clipped to [fromDate, toDate] like the SQL. `delta`
// is the change from the previous row; the first row's delta is its whole
// cumulative, mirroring the SQL first row that folds in the opening balance.
// Other accounts' rows pass through untouched. Result is ordered by
// account_id, bucket.
export function mergeGainSeries(
  rows: TimeseriesRow[],
  series: GainSeries[],
  range: { fromDate?: string; toDate?: string },
): TimeseriesRow[] {
  if (series.length === 0) return rows;
  const replaced = new Set(series.map((s) => s.accountId));
  const out = rows.filter((r) => !replaced.has(r.account_id));
  for (const s of series) {
    let prev = 0;
    for (const p of s.points) {
      if (range.fromDate && p.bucket < range.fromDate) continue;
      if (range.toDate && p.bucket > range.toDate) continue;
      out.push({
        account_id: s.accountId,
        currency: s.currency,
        bucket: p.bucket,
        delta: fmt(p.valueCents - prev),
        cumulative: fmt(p.valueCents),
      });
      prev = p.valueCents;
    }
  }
  return out.sort((a, b) => a.account_id - b.account_id || a.bucket.localeCompare(b.bucket));
}
