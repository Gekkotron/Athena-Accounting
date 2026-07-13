import { describe, it, expect } from 'vitest';
import { normalizeSparkline, summarizePace, topLevelRows } from '../budget-math';
import type { BudgetReport } from '../../../api/types';

function row(overrides: Partial<BudgetReport['rows'][number]>): BudgetReport['rows'][number] {
  return {
    categoryId: 0, name: '', color: null, accountId: null, period: 'monthly',
    limit: '0.00', currency: 'EUR', spent: '0.00', remaining: '0.00', pct: 0, over: false,
    projected: null, history: null, anomaly: false, suggestedLimit: null,
    ...overrides,
  };
}

describe('normalizeSparkline', () => {
  it('scales values relative to their max and flags the last bar as current', () => {
    const bars = normalizeSparkline(['10.00', '20.00', '40.00', '30.00']);
    expect(bars).toHaveLength(4);
    expect(bars[0]!.height).toBeCloseTo(0.25, 3);
    expect(bars[2]!.height).toBeCloseTo(1, 3);
    expect(bars[3]!.isCurrent).toBe(true);
    expect(bars[2]!.isCurrent).toBe(false);
  });

  it('gives zero-only inputs a flat 0-height sparkline', () => {
    const bars = normalizeSparkline(['0.00', '0.00', '0.00']);
    expect(bars.every((b) => b.height === 0)).toBe(true);
  });

  it('handles an empty input', () => {
    expect(normalizeSparkline([])).toEqual([]);
  });
});

describe('summarizePace', () => {
  it('returns "unknown" when projected is null', () => {
    expect(summarizePace({ limit: '100.00', spent: '20.00', remaining: '80.00', projected: null }))
      .toBe('unknown');
  });
  it('returns "over" when projected > limit', () => {
    expect(summarizePace({ limit: '100.00', spent: '80.00', remaining: '20.00', projected: '150.00' }))
      .toBe('over');
  });
  it('returns "onTrack" when projected <= limit', () => {
    expect(summarizePace({ limit: '100.00', spent: '40.00', remaining: '60.00', projected: '90.00' }))
      .toBe('onTrack');
  });
});

describe('topLevelRows', () => {
  it('keeps a row whose category has no parent', () => {
    const rows = [row({ categoryId: 1 })];
    const cats = [{ id: 1, name: 'A', kind: 'expense' as const, color: null, parentId: null, isDefault: false, isInternalTransfer: false }];
    expect(topLevelRows(rows, cats)).toHaveLength(1);
  });

  it('drops a child row when its parent is also budgeted', () => {
    const rows = [row({ categoryId: 1 }), row({ categoryId: 2 })];
    const cats = [
      { id: 1, name: 'Parent', kind: 'expense' as const, color: null, parentId: null, isDefault: false, isInternalTransfer: false },
      { id: 2, name: 'Child',  kind: 'expense' as const, color: null, parentId: 1,    isDefault: false, isInternalTransfer: false },
    ];
    const filtered = topLevelRows(rows, cats);
    expect(filtered.map((r) => r.categoryId)).toEqual([1]);
  });

  it('keeps a child row when its parent is NOT budgeted', () => {
    const rows = [row({ categoryId: 2 })];   // only child is budgeted
    const cats = [
      { id: 1, name: 'Parent', kind: 'expense' as const, color: null, parentId: null, isDefault: false, isInternalTransfer: false },
      { id: 2, name: 'Child',  kind: 'expense' as const, color: null, parentId: 1,    isDefault: false, isInternalTransfer: false },
    ];
    expect(topLevelRows(rows, cats).map((r) => r.categoryId)).toEqual([2]);
  });

  it('returns empty for empty rows', () => {
    expect(topLevelRows([], [])).toEqual([]);
  });
});
