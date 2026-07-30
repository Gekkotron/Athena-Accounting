import { describe, it, expect } from 'vitest';
import { computeMonthlyStats } from '../monthly-stats';
import type { CategoryReportRow } from '../../../api/types';

function row(month: string, total: string, isTransfer = false): CategoryReportRow {
  return {
    category_id: 1,
    category_name: 'X',
    category_kind: null,
    category_is_internal_transfer: isTransfer,
    month,
    total,
    transaction_count: 1,
  };
}

describe('computeMonthlyStats', () => {
  it('returns zeros with monthCount 0 on empty input (no /0)', () => {
    expect(computeMonthlyStats([])).toEqual({ monthCount: 0, avgSpend: 0, avgIncome: 0, avgSavings: 0 });
  });

  it('buckets signed totals per month and averages over months present', () => {
    const out = computeMonthlyStats([
      row('2026-05', '3000.00'),
      row('2026-05', '-1200.00'),
      row('2026-06', '2000.00'),
      row('2026-06', '-800.00'),
    ]);
    expect(out.monthCount).toBe(2);
    expect(out.avgIncome).toBeCloseTo(2500, 6);
    expect(out.avgSpend).toBeCloseTo(-1000, 6); // signed negative
    expect(out.avgSavings).toBeCloseTo(1500, 6);
  });

  it('skips internal-transfer categories entirely', () => {
    const out = computeMonthlyStats([
      row('2026-06', '2000.00'),
      row('2026-06', '-500.00', true), // Épargne-style transfer leg
    ]);
    expect(out.avgSpend).toBe(0);
    expect(out.avgIncome).toBeCloseTo(2000, 6);
  });
});
