import { describe, it, expect } from 'vitest';
import { buildSchedule } from '../../../../../backend/src/domain/loans/engine/index';
import { splitAtDate } from '../split-at-date';
import type { LoanScheduleRow, LoanTermsInput } from '../../../api/loans';

const ASOF = '2026-10-16';
const base: LoanTermsInput = {
  principal: '200000', startDate: '2026-02-05', annualRate: '3.5', insuranceRate: '0.3',
  insuranceBasis: 'remaining', fees: '0',
  periods: [{ kind: 'payment', months: 24, amount: '800' }],
  finalPeriod: { solve: 'payment', endDate: '2046-01' },
  earlyRepayments: [{ date: '2027-01', amount: '10000', effect: 'reduce_payment' }],
};

function run(t: LoanTermsInput) {
  const r = buildSchedule(t, ASOF);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
}
const pick = (r: LoanScheduleRow) => [r.date, r.payment, r.interest, r.capital, r.insurance, r.balance];

describe('splitAtDate', () => {
  const before = run(base);
  const at = before.schedule.findIndex((r) => r.date.startsWith('2030-03'));

  it('new amount: history is reproduced exactly, then the new payment, earlier end', () => {
    const split = splitAtDate(base, before.schedule, '2030-03', { kind: 'amount', amount: '1500' })!;
    expect(split.finalPeriod).toEqual({ solve: 'end_date', amount: '1500' });
    expect(split.earlyRepayments[0]!.effect).toBe('shorten');
    const after = run(split);
    expect(after.schedule.slice(0, at).map(pick)).toEqual(before.schedule.slice(0, at).map(pick));
    expect(after.schedule[at]!.payment).toBe('1500.00');
    expect(after.summary.endDate < before.summary.endDate).toBe(true);
  });

  it('new rate: keeps the end date and lowers the payment', () => {
    const split = splitAtDate(base, before.schedule, '2030-03', { kind: 'rate', rate: '2' })!;
    expect(split.finalPeriod).toEqual({ solve: 'payment', endDate: '2046-01', rate: '2' });
    const after = run(split);
    expect(after.summary.endDate).toBe(before.summary.endDate);
    expect(after.schedule[at]!.rate).toBe('2');
    expect(Number(after.schedule[at]!.payment)).toBeLessThan(Number(before.schedule[at]!.payment));
    expect(after.schedule.slice(0, at).map(pick)).toEqual(before.schedule.slice(0, at).map(pick));
  });

  it('merges identical consecutive months into one period', () => {
    const split = splitAtDate(base, before.schedule, '2030-03', { kind: 'amount', amount: '1500' })!;
    expect(split.periods[0]).toEqual({ kind: 'payment', months: 24, amount: '800.00' });
    expect(split.periods).toHaveLength(2);
  });

  it('returns null outside the loan or on a malformed month', () => {
    const change = { kind: 'amount', amount: '1500' } as const;
    expect(splitAtDate(base, before.schedule, '2026-02', change)).toBeNull(); // first instalment
    expect(splitAtDate(base, before.schedule, '2050-01', change)).toBeNull();
    expect(splitAtDate(base, before.schedule, 'mars', change)).toBeNull();
  });
});
