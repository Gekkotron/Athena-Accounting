export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

export function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function fmt(amount: number): string {
  return (amount < 0 ? '-' : '') + Math.abs(amount).toFixed(2);
}

export function normalize(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Mutations via store.setState() would otherwise leak back into the
// module-level constants below and survive reset().
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
