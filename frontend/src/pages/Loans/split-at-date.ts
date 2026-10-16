import type {
  LoanEarlyRepayment,
  LoanFinalPeriod,
  LoanFixedPeriod,
  LoanScheduleRow,
  LoanTermsInput,
} from '../../api/loans';

export type PaymentChange = { kind: 'amount'; amount: string } | { kind: 'rate'; rate: string };

// "From month X my payment (or rate) changes." Instalments before X become
// fixed history that reproduces exactly what was paid; a new final period
// starts at X — amount fixed → end date floats, rate change → end date kept.
// Returns null unless X is a month of the schedule after the first one.
export function splitAtDate(
  terms: LoanTermsInput,
  schedule: LoanScheduleRow[],
  fromMonth: string,
  change: PaymentChange,
): LoanTermsInput | null {
  const at = schedule.findIndex((r) => r.date.slice(0, 7) === fromMonth);
  const rowAt = schedule[at];
  const lastRow = schedule[schedule.length - 1];
  if (at <= 0 || !rowAt || !lastRow) return null;

  const periods: LoanFixedPeriod[] = [];
  for (const r of schedule.slice(0, at)) {
    const kind = r.kind === 'final' ? 'payment' : r.kind;
    const amount = kind === 'payment' ? r.payment : undefined;
    const rate = r.rate === terms.annualRate ? undefined : r.rate;
    const last = periods[periods.length - 1];
    if (last && last.kind === kind && last.amount === amount && last.rate === rate) {
      last.months += 1;
      continue;
    }
    periods.push({
      kind, months: 1,
      ...(amount !== undefined ? { amount } : {}),
      ...(rate !== undefined ? { rate } : {}),
    });
  }

  const rateInForce = rowAt.rate === terms.annualRate ? {} : { rate: rowAt.rate };
  const finalPeriod: LoanFinalPeriod = change.kind === 'amount'
    ? { solve: 'end_date', amount: change.amount, ...rateInForce }
    : { solve: 'payment', endDate: lastRow.date.slice(0, 7), rate: change.rate };

  // Repayments before X now sit in fixed history. Give them the new final
  // period's neutral effect so the engine's "latest effect decides" rule
  // can't override what the user just asked for.
  const neutral = change.kind === 'amount' ? 'shorten' : 'reduce_payment';
  const earlyRepayments: LoanEarlyRepayment[] = terms.earlyRepayments.map((e) =>
    (e.date < fromMonth ? { ...e, effect: neutral } : e));

  return { ...terms, periods, finalPeriod, earlyRepayments };
}
