import { describe, it, expect } from 'vitest';
import { sortLoans } from '../loan-list';
import type { LoanListItem } from '../../../api/loans';

const item = (id: number, over: Partial<LoanListItem> = {}): LoanListItem => ({
  id, name: `L${id}`, kind: 'other', isSimulation: false, sourceLoanId: null, currency: 'EUR',
  principal: '1000', startDate: '2026-01-01', annualRate: '0', insuranceRate: '0',
  insuranceBasis: 'initial', fees: '0', periods: [], finalPeriod: { solve: 'payment', endDate: '2026-12' },
  earlyRepayments: [], createdAt: `2026-01-0${id}T00:00:00.000Z`, updatedAt: '2026-01-01T00:00:00.000Z',
  summary: null,
  ...over,
});

const withStatus = (status: 'active' | 'repaid') =>
  ({ today: { status } } as unknown as LoanListItem['summary']);

describe('sortLoans', () => {
  it('keeps one tab and puts repaid loans last', () => {
    const all = [
      item(1, { summary: withStatus('repaid') }),
      item(2, { summary: withStatus('active') }),
      item(3, { isSimulation: true }),
      item(4),
    ];
    expect(sortLoans(all, 'loans').map((l) => l.id)).toEqual([2, 4, 1]);
    expect(sortLoans(all, 'simulations').map((l) => l.id)).toEqual([3]);
  });
});
