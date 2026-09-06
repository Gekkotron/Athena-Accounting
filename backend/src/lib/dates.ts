// Backend mirror of frontend/src/lib/dates.ts. The Node process runs in the
// host machine's timezone; `new Date().toISOString().slice(0, 10)` returns
// the UTC day, which drifts past midnight local (a 22:30 CEST call keys the
// next day's date). Every "today" default that feeds an idempotency key or a
// user-facing filename must go through these helpers instead.

export function toLocalIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayLocalIso(): string {
  return toLocalIso(new Date());
}
