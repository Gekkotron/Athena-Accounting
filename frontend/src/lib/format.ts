import i18n from '../i18n';

function currentLocale(): string {
  return i18n.language?.startsWith('en') ? 'en-US' : 'fr-FR';
}

// English is month-first (MM/DD/YYYY); every other supported UI language is
// day-first (DD/MM/YYYY). Drives both parsing and the hint text so the input
// round-trips cleanly with formatDate — otherwise "09/02/2026" pre-filled by
// Intl.DateTimeFormat in en-US would be re-parsed as day-first and silently
// swap day and month at submit time.
function isDayFirstLocale(): boolean {
  return !i18n.language?.startsWith('en');
}

// Interpret a user-typed money value. Accepts French decimal comma, English
// decimal period, integers, interior whitespace, and a trailing €. Returns
// the canonical "X" / "X.Y" / "X.YY" form, or null when the input can't be
// parsed. Backing store for every form field where the user types an amount.
export function parseDecimal(raw: string): string | null {
  const cleaned = raw
    .replace(/€/g, '')
    .replace(/\s+/g, '')
    .replace(',', '.')
    .trim();
  if (!cleaned) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return cleaned;
}

export function formatAmount(value: string | number, currency = 'EUR'): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat(currentLocale(), {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatAmountCompact(value: string | number, currency = 'EUR'): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat(currentLocale(), {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

// Parse a user-entered date string into ISO YYYY-MM-DD. Accepts:
//   "14/07/2025", "14-07-2025", "14.07.2025"  (day-first in FR and other non-en locales)
//   "07/14/2025"                               (month-first when the UI locale is English)
//   "14/7/25"                                  (2-digit year, '70+ → 19xx, else 20xx)
//   "2025-07-14"                               (ISO, passthrough — locale-independent)
// Returns null when the input can't be parsed.
export function parseUserDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
  if (!m) return null;
  const first = m[1]!;
  const second = m[2]!;
  let y = m[3]!;
  if (y.length === 2) y = (Number(y) >= 70 ? '19' : '20') + y;
  const dayFirst = isDayFirstLocale();
  const d = dayFirst ? first : second;
  const mo = dayFirst ? second : first;
  // Sanity-check ranges so "32/01/2025" or "13/25/2025" (en) don't sneak through.
  const dn = Number(d), mn = Number(mo);
  if (mn < 1 || mn > 12 || dn < 1 || dn > 31) return null;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function formatDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  const [y, m, d] = iso.split('T')[0]!.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0);
  return new Intl.DateTimeFormat(currentLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatDateShort(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  const [y, m, d] = iso.split('T')[0]!.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0);
  return new Intl.DateTimeFormat(currentLocale(), {
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(currentLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function amountSignClass(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n) || n === 0) return 'text-ink-300';
  return n > 0 ? 'text-sage-300' : 'text-clay-300';
}
