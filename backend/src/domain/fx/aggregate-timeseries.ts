import { resolveRate } from './resolve-rate.js';
import type { FxRate } from './types.js';

export function aggregateTimeseriesByBucket(
  points: Array<{ currency: string; bucket: string; cumulative: string }>,
  display: string,
  rates: FxRate[],
): Array<{ bucket: string; total: string; unmapped: string[] }> {
  const byBucket = new Map<string, { total: number; unmapped: Set<string> }>();
  for (const p of points) {
    let entry = byBucket.get(p.bucket);
    if (!entry) {
      entry = { total: 0, unmapped: new Set() };
      byBucket.set(p.bucket, entry);
    }
    const rate = resolveRate(rates, p.currency, display, p.bucket);
    if (rate === null) {
      entry.unmapped.add(p.currency);
      continue;
    }
    entry.total += Number(p.cumulative) * rate;
  }
  const buckets = Array.from(byBucket.entries()).sort(([a], [b]) => a.localeCompare(b));
  return buckets.map(([bucket, { total, unmapped }]) => ({
    bucket,
    total: (Math.round((total + Number.EPSILON) * 100) / 100).toFixed(2),
    unmapped: Array.from(unmapped).sort(),
  }));
}
