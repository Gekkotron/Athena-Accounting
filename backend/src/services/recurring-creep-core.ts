// Price-creep detection over a recurring series' member amounts.
// Pure — no DB, no clock — so it unit-tests in isolation like the
// detector core (recurring-detect-core.ts) it sits beside.

export interface PriceCreep {
  // Mean of every occurrence except the latest, in the stored sign
  // convention (expenses negative).
  previousAvg: number;
  // The most recent occurrence's amount, as stored.
  latest: number;
  // Percentage change of the MAGNITUDE (|latest| vs |previousAvg|):
  // positive = the subscription got more expensive (or income grew),
  // negative = it shrank. Sign is deliberately magnitude-based so an
  // expense going -80 → -95 reads as +18.75%, matching how a person
  // says "my bill went up 19%".
  deltaPct: number;
}

// Fewer than 4 occurrences is too little history to call a trend —
// the second occurrence of a new price would flag every young series.
export const CREEP_MIN_OCCURRENCES = 4;
// Both gates must pass: relative (10%) so big bills need a real move,
// absolute (2 currency units) so a 0.20 € bump on a tiny bill stays quiet.
export const CREEP_MIN_PCT = 10;
export const CREEP_MIN_ABS = 2;

export function detectPriceCreep(chronologicalAmounts: readonly number[]): PriceCreep | null {
  if (chronologicalAmounts.length < CREEP_MIN_OCCURRENCES) return null;
  const latest = chronologicalAmounts[chronologicalAmounts.length - 1]!;
  const prior = chronologicalAmounts.slice(0, -1);
  const previousAvg = prior.reduce((a, b) => a + b, 0) / prior.length;

  const magLatest = Math.abs(latest);
  const magAvg = Math.abs(previousAvg);
  if (magAvg === 0) return null;

  const absDelta = magLatest - magAvg;
  const deltaPct = (absDelta / magAvg) * 100;
  if (Math.abs(absDelta) < CREEP_MIN_ABS || Math.abs(deltaPct) < CREEP_MIN_PCT) return null;

  return { previousAvg, latest, deltaPct };
}
