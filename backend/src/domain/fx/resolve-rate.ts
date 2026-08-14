import type { FxRate } from './types.js';

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
