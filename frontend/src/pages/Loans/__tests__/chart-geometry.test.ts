import { describe, it, expect } from 'vitest';
import { chartGeometry } from '../chart-geometry';
import type { LoanScheduleRow } from '../../../api/loans';

const row = (index: number, balance: string, over: Partial<LoanScheduleRow> = {}): LoanScheduleRow => ({
  index, date: `2026-0${index}-05`, periodIndex: 0, kind: 'payment', rate: '0', payment: '100.00',
  interest: '0.00', capital: '100.00', insurance: '0.00', earlyRepayment: null, balance, ...over,
});

describe('chartGeometry', () => {
  const rows = [
    row(1, '300.00'),
    row(2, '150.00', { earlyRepayment: '50.00' }),
    row(3, '100.00', { periodIndex: -1, kind: 'final' }),
    row(4, '0.00', { periodIndex: -1, kind: 'final' }),
  ];

  it('starts at the principal and ends at zero', () => {
    const g = chartGeometry(rows, '400', '2026-02-10', 400, 100);
    expect(g.line.startsWith('M0.0,0.0')).toBe(true);
    expect(g.line.endsWith('L400.0,100.0')).toBe(true);
    expect(g.area.endsWith('L400.0,100 L0,100 Z')).toBe(true);
  });

  it('marks today, period boundaries and early repayments', () => {
    const g = chartGeometry(rows, '400', '2026-02-10', 400, 100);
    expect(g.todayX).toBe(200);
    expect(g.boundaries).toEqual([200]);
    expect(g.early).toEqual([{ x: 200, y: 62.5 }]);
  });

  it('hides the today marker before the start and after the end', () => {
    expect(chartGeometry(rows, '400', '2025-01-01', 400, 100).todayX).toBeNull();
    expect(chartGeometry(rows, '400', '2030-01-01', 400, 100).todayX).toBeNull();
  });
});
