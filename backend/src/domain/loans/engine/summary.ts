import { fromCents, toCents } from './money.js';
import type { LoanSummary, LoanTerms, ScheduleRow } from './types.js';

const sum = (rows: ScheduleRow[], pick: (r: ScheduleRow) => string | null) =>
  rows.reduce((s, r) => s + toCents(pick(r) ?? '0'), 0);

// Totals over the whole schedule plus the "where am I on `asOf`" block.
// An instalment dated on or before `asOf` counts as paid.
export function summarize(
  t: LoanTerms,
  rows: ScheduleRow[],
  penalties: number,
  solvedPayment: number | null,
  asOf: string,
): LoanSummary {
  const principal = toCents(t.principal);
  const interest = sum(rows, (r) => r.interest);
  const insurance = sum(rows, (r) => r.insurance);
  const fees = toCents(t.fees);
  const cost = interest + insurance + fees + penalties;

  const paid = rows.filter((r) => r.date <= asOf);
  const next = rows[paid.length] ?? null;
  const last = rows[rows.length - 1];
  const owed = paid.length > 0 ? toCents(paid[paid.length - 1]!.balance) : principal;
  const status = paid.length === 0 ? 'not_started' : next === null ? 'repaid' : 'active';
  const current = next ?? null;
  const withInsurance = (r: ScheduleRow) => fromCents(toCents(r.payment) + toCents(r.insurance));

  return {
    currentPayment: current ? current.payment : '0.00',
    currentPaymentWithInsurance: current ? withInsurance(current) : '0.00',
    solvedPayment: solvedPayment === null ? null : fromCents(solvedPayment),
    endDate: last ? last.date : t.startDate,
    durationMonths: rows.length,
    totals: {
      interest: fromCents(interest),
      insurance: fromCents(insurance),
      fees: fromCents(fees),
      penalties: fromCents(penalties),
      cost: fromCents(cost),
      totalPaid: fromCents(principal + cost),
    },
    today: {
      asOf,
      capitalOwed: fromCents(owed),
      repaidPct: Math.min(100, Math.max(0, Math.round(((principal - owed) / principal) * 10000) / 100)),
      interestPaid: fromCents(sum(paid, (r) => r.interest)),
      monthsLeft: rows.length - paid.length,
      nextInstalment: next ? { date: next.date, amount: withInsurance(next) } : null,
      status,
    },
  };
}
