import { describe, expect, it } from 'vitest';
import type { Category, CategoryReportRow } from '../../../api/types';
import { buildOwnTotalsByCat, rolledUpTotal } from '../categoriesTotals';

const cat = (id: number, parentId: number | null = null): Category => ({
  id,
  name: `cat-${id}`,
  kind: 'expense',
  parentId,
  color: null,
  isDefault: false,
  isInternalTransfer: false,
});

describe('buildOwnTotalsByCat', () => {
  it('skips rows with null category_id', () => {
    const rows: CategoryReportRow[] = [
      { category_id: null, category_name: null, category_kind: null, category_is_internal_transfer: null, month: '2026-07', total: '-99.00', transaction_count: 1 },
      { category_id: 1,    category_name: 'a',  category_kind: 'expense', category_is_internal_transfer: false, month: '2026-07', total: '-10.00', transaction_count: 1 },
    ];
    const m = buildOwnTotalsByCat(rows);
    expect(m.get(1)).toBeCloseTo(-10);
    expect(m.has(null as unknown as number)).toBe(false);
  });

  it('sums duplicate categories across months', () => {
    const rows: CategoryReportRow[] = [
      { category_id: 1, category_name: 'a', category_kind: 'expense', category_is_internal_transfer: false, month: '2026-07', total: '-10.00', transaction_count: 1 },
      { category_id: 1, category_name: 'a', category_kind: 'expense', category_is_internal_transfer: false, month: '2026-06', total: '-25.00', transaction_count: 2 },
    ];
    expect(buildOwnTotalsByCat(rows).get(1)).toBeCloseTo(-35);
  });
});

describe('rolledUpTotal', () => {
  const own = new Map<number, number>([[1, -100], [2, -30], [3, -20]]);

  it('leaf category with no children returns own total', () => {
    const childrenByParent = new Map<number, Category[]>();
    expect(rolledUpTotal(cat(2), own, childrenByParent)).toBe(-30);
  });

  it('parent with children rolls up direct children', () => {
    const childrenByParent = new Map<number, Category[]>([
      [1, [cat(2, 1), cat(3, 1)]],
    ]);
    expect(rolledUpTotal(cat(1), own, childrenByParent)).toBeCloseTo(-150);
  });

  it('missing entry returns 0', () => {
    const childrenByParent = new Map<number, Category[]>();
    expect(rolledUpTotal(cat(99), own, childrenByParent)).toBe(0);
  });

  it('parent with unknown children still returns own total', () => {
    const childrenByParent = new Map<number, Category[]>([
      [1, [cat(999, 1)]],
    ]);
    expect(rolledUpTotal(cat(1), own, childrenByParent)).toBe(-100);
  });
});
