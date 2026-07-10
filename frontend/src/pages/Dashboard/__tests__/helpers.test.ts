import { describe, it, expect } from 'vitest';
import {
  currentMonthKey,
  recentMonthKeys,
  buildComparison,
  deltaTone,
  type ComparatifRow,
} from '../helpers';
import type { CategoryReportRow } from '../../../api/types';

// Minimal row factory — only the fields buildComparison reads.
function row(partial: Partial<CategoryReportRow>): CategoryReportRow {
  return {
    category_id: null,
    category_name: null,
    category_kind: null,
    category_is_internal_transfer: false,
    month: '2026-07',
    total: '0',
    transaction_count: 0,
    ...partial,
  };
}

const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const CURRENT = '2026-07';

describe('currentMonthKey / recentMonthKeys', () => {
  it('formats the current month as YYYY-MM (UTC)', () => {
    expect(currentMonthKey(new Date(Date.UTC(2026, 6, 15)))).toBe('2026-07');
  });

  it('returns `count` chronological month keys ending at the current month', () => {
    expect(recentMonthKeys(6, new Date(Date.UTC(2026, 6, 15)))).toEqual(MONTHS);
  });

  it('crosses a year boundary correctly', () => {
    expect(recentMonthKeys(3, new Date(Date.UTC(2026, 0, 10)))).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });
});

describe('buildComparison', () => {
  it('filters by sign for expense mode and computes current/previous/delta', () => {
    const rows = [
      row({ category_id: 1, category_name: 'Courses', month: '2026-06', total: '-100.00' }),
      row({ category_id: 1, category_name: 'Courses', month: '2026-07', total: '-150.00' }),
      row({ category_id: 2, category_name: 'Salaire', month: '2026-07', total: '2000.00' }), // income, dropped
    ];
    const out = buildComparison(rows, 'expense', CURRENT, MONTHS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 1,
      name: 'Courses',
      current: 150,
      previous: 100,
      deltaAbs: 50,
    });
    expect(out[0].deltaPct).toBeCloseTo(50);
  });

  it('keeps only positive rows in income mode', () => {
    const rows = [
      row({ category_id: 2, category_name: 'Salaire', month: '2026-07', total: '2000.00' }),
      row({ category_id: 1, category_name: 'Courses', month: '2026-07', total: '-150.00' }),
    ];
    const out = buildComparison(rows, 'income', CURRENT, MONTHS);
    expect(out.map((r) => r.name)).toEqual(['Salaire']);
  });

  it('skips internal-transfer categories', () => {
    const rows = [
      row({ category_id: 3, category_name: 'Épargne', month: '2026-07', total: '-500.00', category_is_internal_transfer: true }),
    ];
    expect(buildComparison(rows, 'expense', CURRENT, MONTHS)).toHaveLength(0);
  });

  it('returns null deltaPct when previous is zero (new category)', () => {
    const rows = [row({ category_id: 4, category_name: 'Vacances', month: '2026-07', total: '-300.00' })];
    const out = buildComparison(rows, 'expense', CURRENT, MONTHS);
    expect(out[0]).toMatchObject({ current: 300, previous: 0, deltaAbs: 300, deltaPct: null });
  });

  it('reports -100% for a category that stopped this month', () => {
    const rows = [row({ category_id: 5, category_name: 'Essence', month: '2026-06', total: '-80.00' })];
    const out = buildComparison(rows, 'expense', CURRENT, MONTHS);
    expect(out[0]).toMatchObject({ current: 0, previous: 80, deltaAbs: -80 });
    expect(out[0].deltaPct).toBeCloseTo(-100);
  });

  it('builds a 6-element chronological sparkline with zero-filled gaps', () => {
    const rows = [
      row({ category_id: 1, category_name: 'Courses', month: '2026-04', total: '-40.00' }),
      row({ category_id: 1, category_name: 'Courses', month: '2026-07', total: '-90.00' }),
    ];
    const out = buildComparison(rows, 'expense', CURRENT, MONTHS);
    expect(out[0].spark).toEqual([0, 0, 40, 0, 0, 90]);
  });

  it('sorts by current desc, then previous desc, then name asc', () => {
    const rows = [
      row({ category_id: 1, category_name: 'B', month: '2026-07', total: '-50.00' }),
      row({ category_id: 2, category_name: 'A', month: '2026-07', total: '-200.00' }),
      row({ category_id: 3, category_name: 'C', month: '2026-06', total: '-70.00' }), // current 0
    ];
    const out = buildComparison(rows, 'expense', CURRENT, MONTHS);
    expect(out.map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });

  it('labels null category id as "Sans catégorie"', () => {
    const rows = [row({ category_id: null, month: '2026-07', total: '-10.00' })];
    expect(buildComparison(rows, 'expense', CURRENT, MONTHS)[0].name).toBe('Sans catégorie');
  });
});

describe('deltaTone', () => {
  it('expense: spending less is favorable (sage), more is unfavorable (clay)', () => {
    expect(deltaTone('expense', -10)).toBe('sage');
    expect(deltaTone('expense', 10)).toBe('clay');
  });
  it('income: earning more is favorable (sage), less is unfavorable (clay)', () => {
    expect(deltaTone('income', 10)).toBe('sage');
    expect(deltaTone('income', -10)).toBe('clay');
  });
  it('zero delta is neutral', () => {
    expect(deltaTone('expense', 0)).toBe('neutral');
  });
});
