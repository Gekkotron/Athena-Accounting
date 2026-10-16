// Integer-cent arithmetic for the loan engine. Every amount is converted to
// cents on the way in and back to a "1234.56" string on the way out, so 600
// months of per-month rounding can't drift.

export function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

export function toCents(s: string): number {
  return roundHalfAway(Number(s) * 100);
}

export function fromCents(c: number): string {
  const sign = c < 0 ? '-' : '';
  const a = Math.abs(c);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

// Nominal annual % → monthly rate (taux proportionnel, what French banks use).
export function monthlyRate(annualPct: string): number {
  return Number(annualPct) / 100 / 12;
}

// Constant instalment (cents) repaying `balance` over `n` months at monthly
// rate `r`. Rounded UP to the cent so the loan always finishes within `n`
// months; the last instalment absorbs the difference.
export function annuity(balance: number, r: number, n: number): number {
  if (n <= 0) return balance;
  if (r === 0) return Math.ceil(balance / n);
  return Math.ceil((balance * r) / (1 - Math.pow(1 + r, -n)) - 1e-9);
}

// Months needed to repay `balance` with instalment `payment` (cents), stepping
// with the same per-month rounding as the schedule. null = never repaid.
export function monthsToRepay(balance: number, r: number, payment: number, cap: number): number | null {
  let b = balance;
  for (let n = 1; n <= cap; n++) {
    const interest = roundHalfAway(b * r);
    const capital = payment - interest;
    if (capital <= 0) return null;
    if (capital >= b) return n;
    b -= capital;
  }
  return null;
}
