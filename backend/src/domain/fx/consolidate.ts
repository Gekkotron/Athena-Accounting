import { resolveRate } from './resolve-rate.js';
import type { FxRate, ConsolidatedTotals } from './types.js';

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
  const running: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
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
