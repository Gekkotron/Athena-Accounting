import { describe, it, expect } from 'vitest';
import { groupByYear } from '../schedule-groups';
import type { LoanScheduleRow } from '../../../api/loans';

const row = (date: string, payment: string, interest: string): LoanScheduleRow => ({
  index: 0, date, periodIndex: -1, kind: 'final', rate: '3.5', payment, interest,
  capital: (Number(payment) - Number(interest)).toFixed(2), insurance: '10.00', earlyRepayment: null, balance: '0.00',
});

describe('groupByYear', () => {
  it('groups rows per calendar year with exact cent totals', () => {
    const g = groupByYear([
      row('2026-11-05', '100.10', '10.01'),
      row('2026-12-05', '100.20', '10.02'),
      row('2027-01-05', '100.30', '10.03'),
    ]);
    expect(g.map((y) => y.year)).toEqual(['2026', '2027']);
    expect(g[0]!.totals).toEqual({ payment: '200.30', interest: '20.03', capital: '180.27', insurance: '20.00' });
    expect(g[1]!.rows).toHaveLength(1);
  });
});
