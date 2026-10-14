// Valeur / Versé / Gain computation for one account. Money arrives and leaves
// as 2-decimal strings (Postgres numeric text); arithmetic goes through
// integer cents to avoid float drift.

export type ValuationInput = {
  type: string;
  currentBalance: string;
  // Net contributions (Versé); null for account types that have none.
  contributed: string | null;
  // Latest valuation at or before today; null when none was entered.
  latestValue: string | null;
};

export type ValuationResult = {
  value: string;
  gain: string | null;
  // Ratio (0.05 = +5%), rounded to 4 decimals; null when Versé <= 0.
  gainPct: number | null;
};

function toCents(s: string): number {
  return Math.round(Number(s) * 100);
}

function fromCents(c: number): string {
  return (c / 100).toFixed(2);
}

export function computeValuation(input: ValuationInput): ValuationResult {
  const valueCents = toCents(
    input.type === 'investment' && input.latestValue !== null
      ? input.latestValue
      : input.currentBalance,
  );
  if (input.contributed === null) {
    return { value: fromCents(valueCents), gain: null, gainPct: null };
  }
  const contributedCents = toCents(input.contributed);
  const gainCents = valueCents - contributedCents;
  const gainPct =
    contributedCents > 0 ? Math.round((gainCents / contributedCents) * 10000) / 10000 : null;
  return { value: fromCents(valueCents), gain: fromCents(gainCents), gainPct };
}
