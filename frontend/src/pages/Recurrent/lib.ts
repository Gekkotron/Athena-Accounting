// Shared helpers for the Récurrent tabs.

import type { RecurringSeries } from '../../api/types';

// Fixed French labels for the four cadence buckets the detector emits.
// Non-standard cadences (from a future extension) fall back to "N jours".
export function cadenceLabel(days: number): string {
  if (days === 7) return 'Hebdomadaire';
  if (days === 30) return 'Mensuel';
  if (days === 90) return 'Trimestriel';
  if (days === 365) return 'Annuel';
  return `${days} jours`;
}

// Monthly-equivalent amount for aggregation. Keeps sign — an income
// series stays positive, an expense series stays negative — so caller
// can format with the amount-sign colour helper.
export function monthlyEquivalent(row: Pick<RecurringSeries, 'avgAmount' | 'cadenceDays'>): number {
  const amt = Number(row.avgAmount);
  if (!Number.isFinite(amt) || row.cadenceDays <= 0) return 0;
  return amt * (30 / row.cadenceDays);
}

// Sum the monthly-equivalent of a set of series.
export function monthlyEquivalentTotal(rows: RecurringSeries[]): number {
  let sum = 0;
  for (const r of rows) sum += monthlyEquivalent(r);
  return sum;
}
