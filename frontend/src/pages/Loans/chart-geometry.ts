import type { LoanScheduleRow } from '../../api/loans';

export interface ChartGeometry {
  area: string; // closed path under the curve
  line: string; // the curve itself
  todayX: number | null; // null before the first / after the last instalment
  boundaries: number[]; // x of each period change
  early: Array<{ x: number; y: number }>; // early repayment markers
}

// Point 0 is the principal before any instalment; point i is the capital
// owed after instalment i. y grows downward (SVG), 0 € sits on the bottom.
export function chartGeometry(
  rows: LoanScheduleRow[],
  principal: string,
  asOf: string,
  w: number,
  h: number,
): ChartGeometry {
  const values = [Number(principal), ...rows.map((r) => Number(r.balance))];
  const max = Math.max(...values, 1);
  const n = Math.max(values.length - 1, 1);
  const x = (i: number) => (i / n) * w;
  const y = (v: number) => h - (v / max) * h;
  const line = `M${values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L')}`;
  const paid = rows.filter((r) => r.date <= asOf).length;
  return {
    line,
    area: `${line} L${x(n).toFixed(1)},${h} L0,${h} Z`,
    todayX: paid > 0 && paid < rows.length ? x(paid) : null,
    boundaries: rows.flatMap((r, i) => (i > 0 && r.periodIndex !== rows[i - 1]!.periodIndex ? [x(i)] : [])),
    early: rows.flatMap((r, i) => (r.earlyRepayment ? [{ x: x(i + 1), y: y(Number(r.balance)) }] : [])),
  };
}
