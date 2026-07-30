// Date helpers with zero dependencies — safe to import from demo handler
// libs and pure unit tests, unlike format.ts which pulls in i18n.

// Format a Date as its LOCAL calendar day, YYYY-MM-DD.
export function toLocalIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The user's local calendar day. `new Date().toISOString().slice(0, 10)` is
// UTC — for a UTC+2 user it flips to tomorrow's date at 22:00, so every
// "default to today" form field must use this instead.
export function todayLocalIso(): string {
  return toLocalIso(new Date());
}
