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

import type { CategoryReportRow } from '../../api/types';

export type ComparatifMode = 'expense' | 'income';

export interface ComparatifRow {
  id: number | null;
  name: string;
  color: string | null;
  current: number;
  previous: number;
  deltaAbs: number;
  deltaPct: number | null;
  spark: number[];
}

// Current month as "YYYY-MM" (UTC), matching the report's date_trunc.
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// `count` month keys, chronological, ending at the current month.
export function recentMonthKeys(count: number, now: Date = new Date()): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

// Which delta direction is "good" depends on the mode; expenses invert.
export function deltaTone(mode: ComparatifMode, deltaAbs: number): 'sage' | 'clay' | 'neutral' {
  if (deltaAbs === 0) return 'neutral';
  const favorable = mode === 'expense' ? deltaAbs < 0 : deltaAbs > 0;
  return favorable ? 'sage' : 'clay';
}

// Aggregate per-(category, month) rows into per-category comparison rows.
// `currentMonth` and `months` are injected so this stays clock-independent.
export function buildComparison(
  rows: CategoryReportRow[],
  mode: ComparatifMode,
  currentMonth: string,
  months: string[],
): ComparatifRow[] {
  const monthIndex = new Map(months.map((m, i) => [m, i] as const));
  const previousMonth = months[months.indexOf(currentMonth) - 1] ?? null;

  interface Acc {
    id: number | null;
    name: string;
    color: string | null;
    spark: number[];
  }
  const byCat = new Map<number | null, Acc>();

  for (const r of rows) {
    if (r.category_is_internal_transfer) continue;
    const amt = Number(r.total);
    if (!Number.isFinite(amt) || amt === 0) continue;
    if (mode === 'expense' && amt >= 0) continue;
    if (mode === 'income' && amt <= 0) continue;

    let acc = byCat.get(r.category_id);
    if (!acc) {
      acc = {
        id: r.category_id,
        name: r.category_name ?? 'Sans catégorie',
        color: null,
        spark: new Array(months.length).fill(0),
      };
      byCat.set(r.category_id, acc);
    }
    const idx = monthIndex.get(r.month);
    if (idx !== undefined) acc.spark[idx] += Math.abs(amt);
  }

  const out: ComparatifRow[] = [];
  for (const acc of byCat.values()) {
    const current = acc.spark[monthIndex.get(currentMonth) ?? -1] ?? 0;
    const previous = previousMonth === null ? 0 : acc.spark[monthIndex.get(previousMonth)!] ?? 0;
    const deltaAbs = current - previous;
    out.push({
      id: acc.id,
      name: acc.name,
      color: acc.color,
      current,
      previous,
      deltaAbs,
      deltaPct: previous === 0 ? null : (deltaAbs / previous) * 100,
      spark: acc.spark,
    });
  }

  out.sort(
    (a, b) => b.current - a.current || b.previous - a.previous || a.name.localeCompare(b.name),
  );
  return out;
}
