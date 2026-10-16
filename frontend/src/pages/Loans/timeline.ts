import type { LoanScheduleRow } from '../../api/loans';

export interface TimelineItem {
  periodIndex: number; // -1 = final period
  kind: LoanScheduleRow['kind'];
  from: string;
  to: string;
  months: number;
  payment: string; // first instalment of the period
  rate: string;
  varies: boolean; // payment changes inside the period (reduce_payment repayment)
}

// One item per run of rows sharing a period. The loan's very last
// instalment absorbs rounding, so it never counts as a change.
export function timelineItems(rows: LoanScheduleRow[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  rows.forEach((r, i) => {
    const cur = items[items.length - 1];
    if (cur && cur.periodIndex === r.periodIndex) {
      cur.to = r.date;
      cur.months += 1;
      if (i < rows.length - 1 && r.payment !== cur.payment) cur.varies = true;
      return;
    }
    items.push({
      periodIndex: r.periodIndex, kind: r.kind, from: r.date, to: r.date,
      months: 1, payment: r.payment, rate: r.rate, varies: false,
    });
  });
  return items;
}
