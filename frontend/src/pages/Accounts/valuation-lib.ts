// A valuation older than this many days is flagged amber on the account card.
export const STALE_VALUATION_DAYS = 30;

// True when the latest valuation date is more than STALE_VALUATION_DAYS
// before `today` (both YYYY-MM-DD). Null/absent dates are never stale.
export function isValuationStale(date: string | null | undefined, today: string): boolean {
  if (!date) return false;
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return (toUtc(today) - toUtc(date)) / 86_400_000 > STALE_VALUATION_DAYS;
}

// `gainPct` arrives from the API as a ratio (0.0523 = +5.23 %). Returns a
// signed percentage string (two decimals, "+" on positives).
export function formatGainPct(ratio: number, locale: string): string {
  const pct = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: 'exceptZero',
  }).format(ratio * 100);
  return `${pct} %`;
}

// Signed amount ("+1 234,00 €" / "−50,00 €"): formatAmount only prints the
// minus, so positives get an explicit plus here.
export function signedAmount(value: string | number, format: (v: string | number) => string): string {
  const n = Number(value);
  return n > 0 ? `+${format(value)}` : format(value);
}

export function gainToneClass(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (n > 0.004) return 'text-sage-300';
  if (n < -0.004) return 'text-clay-300';
  return 'text-ink-400';
}

export function numberLocale(language: string | undefined): string {
  return language?.startsWith('en') ? 'en-US' : 'fr-FR';
}

// Locked part of an account, mirroring the backend balance report: the
// book-based locked amount (current − available), plus the valuation
// adjustment (Valeur − book) only while the account-level lock is active.
// An unlocked investment's plus-value is Placé, never Bloqué.
export function lockedAmount(
  a: {
    value?: string | null;
    currentBalance?: string | null;
    availableBalance?: string | null;
    lockYears?: number | null;
    openingDate: string;
  },
  today: string,
): number {
  const book = Number(a.currentBalance ?? '0');
  const available = Number(a.availableBalance ?? a.currentBalance ?? '0');
  const value = Number(a.value ?? a.currentBalance ?? '0');
  let locked = book - available;
  if (a.lockYears != null) {
    const [y, m, d] = a.openingDate.split('-');
    const unlock = `${Number(y) + a.lockYears}-${m}-${d}`;
    if (unlock > today) locked += value - book;
  }
  return locked;
}
