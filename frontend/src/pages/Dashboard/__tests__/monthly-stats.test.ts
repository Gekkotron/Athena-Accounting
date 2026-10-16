import { describe, it, expect } from 'vitest';
import { computeMonthlyStats } from '../monthly-stats';
import type { CategoryReportRow } from '../../../api/types';

function row(
  month: string,
  total: string,
  isTransfer = false,
  kind: CategoryReportRow['category_kind'] = null,
): CategoryReportRow {
  return {
    category_id: 1,
    category_name: 'X',
    category_kind: kind,
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
      row('2026-05', '3000.00', false, 'income'),
      row('2026-05', '-1200.00', false, 'expense'),
      row('2026-06', '2000.00', false, 'income'),
      row('2026-06', '-800.00', false, 'expense'),
    ]);
    expect(out.monthCount).toBe(2);
    expect(out.avgIncome).toBeCloseTo(2500, 6);
    expect(out.avgSpend).toBeCloseTo(-1000, 6); // signed negative
    expect(out.avgSavings).toBeCloseTo(1500, 6);
  });

  it('skips internal-transfer categories entirely', () => {
    const out = computeMonthlyStats([
      row('2026-06', '2000.00', false, 'income'),
      row('2026-06', '-500.00', true), // Épargne-style transfer leg
    ]);
    expect(out.avgSpend).toBe(0);
    expect(out.avgIncome).toBeCloseTo(2000, 6);
  });

  it('counts only income-kind categories as revenue (matches the Sankey)', () => {
    const out = computeMonthlyStats([
      row('2026-06', '2000.00', false, 'income'),
      row('2026-06', '-900.00', false, 'expense'),
      // Refund month: the expense category nets positive. Not revenue —
      // it reduces spending instead.
      row('2026-06', '150.00', false, 'expense'),
      // Uncategorised / neutral credits are not revenue either.
      row('2026-06', '50.00', false, null),
      row('2026-06', '-30.00', false, 'neutral'),
      // A negative income-kind month (salary clawback) lowers revenue,
      // it is not spending.
      row('2026-07', '2200.00', false, 'income'),
      row('2026-07', '-200.00', false, 'income'),
      row('2026-07', '-1000.00', false, 'expense'),
    ]);
    expect(out.monthCount).toBe(2);
    expect(out.avgIncome).toBeCloseTo((2000 + 2000) / 2, 6);
    expect(out.avgSpend).toBeCloseTo((-900 + 150 + 50 - 30 - 1000) / 2, 6);
    // Savings stays the true net cash flow regardless of bucketing.
    expect(out.avgSavings).toBeCloseTo((2000 - 900 + 150 + 50 - 30 + 2200 - 200 - 1000) / 2, 6);
  });
});
