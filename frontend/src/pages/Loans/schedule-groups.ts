import type { LoanScheduleRow } from '../../api/loans';

export interface YearGroup {
  year: string;
  rows: LoanScheduleRow[];
  totals: { payment: string; interest: string; capital: string; insurance: string };
}

const cents = (s: string) => Math.round(Number(s) * 100);
const money = (c: number) => (c / 100).toFixed(2);

// Calendar-year buckets with totals summed in cents (no float drift).
export function groupByYear(rows: LoanScheduleRow[]): YearGroup[] {
  const groups: Array<{ year: string; rows: LoanScheduleRow[] }> = [];
  for (const r of rows) {
    const year = r.date.slice(0, 4);
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.rows.push(r);
    else groups.push({ year, rows: [r] });
  }
  return groups.map((g) => {
    const sum = (k: 'payment' | 'interest' | 'capital' | 'insurance') =>
      money(g.rows.reduce((s, r) => s + cents(r[k]), 0));
    return {
      ...g,
      totals: { payment: sum('payment'), interest: sum('interest'), capital: sum('capital'), insurance: sum('insurance') },
    };
  });
}
