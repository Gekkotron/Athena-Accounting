import { describe, it, expect } from 'vitest';
import { timelineItems } from '../timeline';
import type { LoanScheduleRow } from '../../../api/loans';

const row = (index: number, periodIndex: number, payment: string, kind: LoanScheduleRow['kind'] = 'payment'): LoanScheduleRow => ({
  index, date: `2026-${String(index).padStart(2, '0')}-05`, periodIndex, kind, rate: '3.5', payment,
  interest: '0.00', capital: '0.00', insurance: '0.00', earlyRepayment: null, balance: '0.00',
});

describe('timelineItems', () => {
  it('groups consecutive rows by period', () => {
    const items = timelineItems([
      row(1, 0, '583.33', 'partial_deferral'),
      row(2, 0, '583.33', 'partial_deferral'),
      row(3, -1, '1159.92', 'final'),
      row(4, -1, '1159.92', 'final'),
      row(5, -1, '1100.15', 'final'), // last instalment absorbs rounding — not a change
    ]);
    expect(items).toEqual([
      { periodIndex: 0, kind: 'partial_deferral', from: '2026-01-05', to: '2026-02-05', months: 2, payment: '583.33', rate: '3.5', varies: false },
      { periodIndex: -1, kind: 'final', from: '2026-03-05', to: '2026-05-05', months: 3, payment: '1159.92', rate: '3.5', varies: false },
    ]);
  });

  it('flags a period whose payment changes mid-way', () => {
    const items = timelineItems([row(1, -1, '1000.00', 'final'), row(2, -1, '900.00', 'final'), row(3, -1, '900.00', 'final')]);
    expect(items[0]!.varies).toBe(true);
  });
});
