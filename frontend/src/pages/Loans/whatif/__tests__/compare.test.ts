import { describe, it, expect } from 'vitest';
import { compareSummaries } from '../compare';
import type { LoanSummary } from '../../../../api/loans';

const s = (endDate: string, cost: string, monthly: string) =>
  ({ endDate, currentPaymentWithInsurance: monthly, totals: { cost } } as unknown as LoanSummary);

describe('compareSummaries', () => {
  it('reports month, cost and payment deltas', () => {
    expect(compareSummaries(s('2046-01-05', '90380.80', '1209.92'), s('2043-05-05', '82880.10', '1209.92'))).toEqual({
      endMonthsDelta: -32, costDelta: '-7500.70', monthlyDelta: '0.00',
    });
  });
});
