import type { LoanSummary } from '../../../api/loans';

export interface Comparison {
  endMonthsDelta: number; // negative = ends earlier
  costDelta: string; // negative = cheaper
  monthlyDelta: string;
}

const cents = (s: string) => Math.round(Number(s) * 100);
const money = (c: number) => (c / 100).toFixed(2);
const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

export function compareSummaries(base: LoanSummary, next: LoanSummary): Comparison {
  return {
    endMonthsDelta: monthIndex(next.endDate) - monthIndex(base.endDate),
    costDelta: money(cents(next.totals.cost) - cents(base.totals.cost)),
    monthlyDelta: money(cents(next.currentPaymentWithInsurance) - cents(base.currentPaymentWithInsurance)),
  };
}
