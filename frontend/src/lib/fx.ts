// Deliberate duplicate of backend/src/domain/fx/{types,resolve-rate,
// consolidate,aggregate-timeseries}.ts. Cross-package source sharing isn't
// set up (different tsconfig, different module resolver), so the frontend
// carries its own copy of the pure FX math. Keep every function body
// byte-identical to its backend counterpart — drift here silently breaks
// demo/real parity instead of failing loudly.

export type FxRate = {
  fromCcy: string;
  toCcy: string;
  effectiveFrom: string; // ISO YYYY-MM-DD
  rate: string;          // stringified numeric to preserve precision
};

export type ConsolidatedTotals<K extends string> = {
  display: string;
  totals: Record<K, string>; // stringified numeric, 2-decimal quantized
  unmapped: Array<{ currency: string } & Record<K, string>>;
};

export function resolveRate(
  rates: FxRate[],
  from: string,
  to: string,
  at: string,
): number | null {
  if (from === to) return 1;
  let best: FxRate | null = null;
  for (const r of rates) {
    if (r.fromCcy !== from || r.toCcy !== to) continue;
    if (r.effectiveFrom > at) continue;
    if (best === null || r.effectiveFrom > best.effectiveFrom) {
      best = r;
    }
  }
  return best === null ? null : Number(best.rate);
}

// Half-up rounding to 2 decimals via a scaled integer round.
function quantize2(n: number): string {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}

export function consolidate<K extends string>(
  rows: Array<{ currency: string } & Record<K, string>>,
  display: string,
  rates: FxRate[],
  at: string,
  keys: readonly K[],
): ConsolidatedTotals<K> {
  const running = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  const unmapped: Array<{ currency: string } & Record<K, string>> = [];

  for (const row of rows) {
    const rate = resolveRate(rates, row.currency, display, at);
    if (rate === null) {
      unmapped.push(row);
      continue;
    }
    for (const k of keys) {
      running[k] += Number(row[k]) * rate;
    }
  }

  const totals = Object.fromEntries(
    keys.map((k) => [k, quantize2(running[k])]),
  ) as Record<K, string>;

  return { display, totals, unmapped };
}

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
