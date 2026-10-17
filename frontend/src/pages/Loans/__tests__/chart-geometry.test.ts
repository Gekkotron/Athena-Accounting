import { describe, it, expect } from 'vitest';
import { chartGeometry } from '../chart-geometry';
import type { LoanScheduleRow } from '../../../api/loans';

const row = (index: number, balance: string, over: Partial<LoanScheduleRow> = {}): LoanScheduleRow => ({
  index, date: `2026-0${index}-05`, periodIndex: 0, kind: 'payment', rate: '0', payment: '100.00',
  interest: '0.00', capital: '100.00', insurance: '0.00', earlyRepayment: null, balance, ...over,
});

describe('chartGeometry', () => {
  const rows = [
    row(1, '300.00', { interest: '10.00', insurance: '2.00' }),
    row(2, '150.00', { earlyRepayment: '50.00', interest: '8.00', insurance: '2.00' }),
    row(3, '100.00', { periodIndex: -1, kind: 'final', interest: '4.00', insurance: '2.00' }),
    row(4, '0.00', { periodIndex: -1, kind: 'final', interest: '2.00', insurance: '2.00' }),
  ];

  // Totals: cumCap end = 100 + (100+50) + 100 + 100 = 450; interest = 24; insurance = 8
  // max = max(450+24+8, 400) = 482. w=400, h=100. x step = w/n with n = rows.length = 4.

  it('capital area starts at the baseline and climbs with every repayment', () => {
    const g = chartGeometry(rows, '400', '2026-02-10', 400, 100);
    // top path begins at (0, 100) because index 0 = nothing repaid yet
    expect(g.capitalArea.startsWith('M0.0,100.0')).toBe(true);
    // closed via baseline reversal
    expect(g.capitalArea.endsWith('L0.0,100.0 Z')).toBe(true);
  });

  it('total line reaches the stack top at the end and starts at the baseline', () => {
    const g = chartGeometry(rows, '400', '2026-02-10', 400, 100);
    expect(g.totalLine.startsWith('M0.0,100.0')).toBe(true);
    // At index 4: total = 450+24+8 = 482; max = 482; so y = 100 - 100 = 0
    expect(g.totalLine.endsWith('L400.0,0.0')).toBe(true);
  });

  it('marks today, period boundaries and early repayments', () => {
    const g = chartGeometry(rows, '400', '2026-02-10', 400, 100);
    expect(g.todayX).toBe(200); // 2 paid out of 4 (rows 01-05 and 02-05) → x = 2/4 * 400 = 200
    expect(g.boundaries).toEqual([200]); // periodIndex changes between row 2 (0) and row 3 (-1)
    // early repayment on row 2 (index i=1) → marker at x(i+1) = x(2) = 200
    // cumCap at index 2 = 100 (row1) + 150 (row2 incl 50 early) = 250; y = 100 - 250/482*100 ≈ 48.1
    expect(g.early).toHaveLength(1);
    expect(g.early[0]!.x).toBe(200);
    expect(g.early[0]!.y).toBeCloseTo(48.1, 1);
  });

  it('hides the today marker before the start and after the end', () => {
    expect(chartGeometry(rows, '400', '2025-01-01', 400, 100).todayX).toBeNull();
    expect(chartGeometry(rows, '400', '2030-01-01', 400, 100).todayX).toBeNull();
  });
});
