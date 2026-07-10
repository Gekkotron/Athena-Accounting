// Look back N complete months (excludes the current month, since a
// half-finished month drags the average toward zero).
export const AVG_WINDOW_MONTHS = 12;

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
