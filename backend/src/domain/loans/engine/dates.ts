// Month arithmetic on ISO strings. No Date objects for the calendar maths —
// only to find a month's last day — so time zones can't shift a date.

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && ISO_DATE.test(s);
}

export function isYearMonth(s: unknown): s is string {
  return typeof s === 'string' && YEAR_MONTH.test(s);
}

// Absolute month number for "YYYY-MM" or "YYYY-MM-DD".
export function monthIndex(s: string): number {
  return Number(s.slice(0, 4)) * 12 + (Number(s.slice(5, 7)) - 1);
}

const pad = (n: number) => String(n).padStart(2, '0');

// Date of the instalment `k` months after `startDate` (k = 0 → startDate),
// keeping the day of month and clamping to the month's last day.
export function instalmentDate(startDate: string, k: number): string {
  const idx = monthIndex(startDate) + k;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(Number(startDate.slice(8, 10)), lastDay);
  return `${y}-${pad(m)}-${pad(day)}`;
}
