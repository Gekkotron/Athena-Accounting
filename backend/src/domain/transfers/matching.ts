// Pure helpers used by the transfer detector. Extracted so they can be
// unit-tested without needing a Postgres instance (the detector itself is
// DB-heavy and only runs under RUN_DB_TESTS=1).

const ACCENT_RE = /[̀-ͯ]/g;

// Lowercase + strip diacritics (NFD-decompose then drop combining marks).
// Used to fold transfer-rule keywords and transaction labels into a
// case + accent-insensitive comparison space.
export function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(ACCENT_RE, '');
}

// Add `days` (may be negative) to an ISO YYYY-MM-DD date, returning
// another ISO YYYY-MM-DD date. UTC arithmetic so DST switches don't
// shift the result off by an hour and land on the previous day.
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Sign-flip a decimal string amount. "-12.34" → "12.34"; "12.34" → "-12.34".
// The transaction table stores amounts as strings; this keeps them string-
// typed so downstream drizzle equality checks match without a re-cast.
export function negate(amount: string): string {
  return amount.startsWith('-') ? amount.slice(1) : `-${amount}`;
}
