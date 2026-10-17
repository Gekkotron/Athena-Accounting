import type { LoanScheduleRow } from '../../api/loans';

export interface ChartGeometry {
  capitalArea: string; // cumulative capital repaid, stacked from the baseline
  interestArea: string; // cumulative interest, stacked above capital
  insuranceArea: string; // cumulative insurance, stacked above interest
  totalLine: string; // top of the stack — total paid over time
  todayX: number | null;
  boundaries: number[]; // x of each period change
  early: Array<{ x: number; y: number }>; // early repayment markers on the capital area
}

// Each layer is cumulative over the schedule: at index i we have what has
// been paid in capital/interest/insurance after instalment i. Index 0 is
// before any payment (all zero). Layers stack from the baseline up; the
// stack's final height is the loan's total cost (principal + interest +
// insurance).
export function chartGeometry(
  rows: LoanScheduleRow[],
  principal: string,
  asOf: string,
  w: number,
  h: number,
): ChartGeometry {
  const P = Number(principal);
  const cumCap: number[] = [0];
  const cumInt: number[] = [0];
  const cumIns: number[] = [0];
  rows.forEach((r) => {
    const cap = Number(r.capital) + Number(r.earlyRepayment ?? 0);
    cumCap.push(cumCap[cumCap.length - 1]! + cap);
    cumInt.push(cumInt[cumInt.length - 1]! + Number(r.interest));
    cumIns.push(cumIns[cumIns.length - 1]! + Number(r.insurance));
  });

  const last = cumCap.length - 1;
  const totalEnd = cumCap[last]! + cumInt[last]! + cumIns[last]!;
  const max = Math.max(totalEnd, P, 1);
  const n = Math.max(last, 1);
  const x = (i: number) => (i / n) * w;
  const y = (v: number) => h - (v / max) * h;

  type Pt = { x: number; y: number };
  const pts = (fn: (i: number) => number): Pt[] =>
    cumCap.map((_, i) => ({ x: x(i), y: y(fn(i)) }));
  const base: Pt[] = cumCap.map((_, i) => ({ x: x(i), y: h }));
  const capTop = pts((i) => cumCap[i]!);
  const intTop = pts((i) => cumCap[i]! + cumInt[i]!);
  const insTop = pts((i) => cumCap[i]! + cumInt[i]! + cumIns[i]!);

  const toSeg = (ps: Pt[]) => ps.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L');
  const area = (top: Pt[], bot: Pt[]) =>
    `M${toSeg(top)} L${toSeg([...bot].reverse())} Z`;

  const paid = rows.filter((r) => r.date <= asOf).length;

  return {
    capitalArea: area(capTop, base),
    interestArea: area(intTop, capTop),
    insuranceArea: area(insTop, intTop),
    totalLine: `M${toSeg(insTop)}`,
    todayX: paid > 0 && paid < rows.length ? x(paid) : null,
    boundaries: rows.flatMap((r, i) => (i > 0 && r.periodIndex !== rows[i - 1]!.periodIndex ? [x(i)] : [])),
    early: rows.flatMap((r, i) => (r.earlyRepayment ? [{ x: x(i + 1), y: y(cumCap[i + 1]!) }] : [])),
  };
}
