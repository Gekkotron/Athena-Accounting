import type { Account } from '../../api/types';

// Look back N complete months (excludes the current month, since a
// half-finished month drags the average toward zero).
export const AVG_WINDOW_MONTHS = 12;

// Mirrors the backend's "available" concept (see accounts/list.ts): an
// account's balance is currently in-play iff it has no lock, or its lock
// window has elapsed. Used to resolve the Dashboard's 'available' chart
// scope into an id list.
export function isAccountAvailable(a: Account, today: Date = new Date()): boolean {
  const years = a.lockYears;
  if (years == null) return true;
  // openingDate is 'YYYY-MM-DD'. Compare in UTC so a laptop crossing a
  // timezone during the lock window doesn't wobble by a day.
  const [y, m, d] = a.openingDate.split('-').map(Number);
  if (!y || !m || !d) return true; // malformed date: fall open (matches the SQL's OR-null tolerance)
  const unlockAt = Date.UTC(y + years, m - 1, d);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return unlockAt <= todayUtc;
}

export function monthAgoISODate(monthsBack: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// Last day of the PREVIOUS month, so the current (half-finished) month is
// excluded from the sliding window entirely. Prior version returned the 1st
// of the current month and let a `<=` filter leak day-1 transactions in.
export function lastDayOfPrevMonthISODate(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
