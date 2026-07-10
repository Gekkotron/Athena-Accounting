import { describe, it, expect } from 'vitest';
import { buildSankeyModel } from '../sankey';
import type { Category, CategoryReportRow } from '../../../api/types';

const cat = (id: number, name: string, kind: Category['kind'], over: Partial<Category> = {}): Category => ({
  id, name, kind, color: null, parentId: null, isDefault: false, isInternalTransfer: false, ...over,
});
const row = (category_id: number | null, kind: CategoryReportRow['category_kind'], total: string): CategoryReportRow => ({
  category_id, category_name: null, category_kind: kind, category_is_internal_transfer: false,
  month: '2026-06', total, transaction_count: 1,
});

describe('buildSankeyModel', () => {
  it('splits income vs expense and negates expense totals to positive', () => {
    const cats = [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')];
    const rows = [row(1, 'income', '3000.00'), row(2, 'expense', '-800.00')];
    const m = buildSankeyModel(rows, cats, 'EUR');
    expect(m.totalIncome).toBe(3000);
    expect(m.totalExpense).toBe(800);
    expect(m.incomeNodes[0]).toMatchObject({ label: 'Salaire', amount: 3000 });
    expect(m.expenseNodes[0]).toMatchObject({ label: 'Courses', amount: 800 });
  });

  it('rolls leaf categories up to their root ancestor', () => {
    const cats = [cat(1, 'Maison', 'expense'), cat(2, 'Loyer', 'expense', { parentId: 1 }), cat(3, 'EDF', 'expense', { parentId: 1 })];
    const rows = [row(2, 'expense', '-500.00'), row(3, 'expense', '-100.00')];
    const m = buildSankeyModel(rows, cats, 'EUR');
    expect(m.expenseNodes).toHaveLength(1);
    expect(m.expenseNodes[0]).toMatchObject({ label: 'Maison', amount: 600 });
  });

  it('bundles categories beyond topN into an Autres node, sorted by amount', () => {
    const cats = [1, 2, 3].map((i) => cat(i, `C${i}`, 'expense'));
    const rows = [row(1, 'expense', '-300'), row(2, 'expense', '-200'), row(3, 'expense', '-50')];
    const m = buildSankeyModel(rows, cats, 'EUR', { topNExpense: 2 });
    expect(m.expenseNodes.map((n) => n.label)).toEqual(['C1', 'C2', 'Autres']);
    expect(m.expenseNodes[2]).toMatchObject({ label: 'Autres', amount: 50 });
  });

  it('computes a positive savings node and zero deficit on surplus', () => {
    const cats = [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')];
    const m = buildSankeyModel([row(1, 'income', '3000'), row(2, 'expense', '-800')], cats, 'EUR');
    expect(m.savings).toBe(2200);
    expect(m.deficit).toBe(0);
  });

  it('computes a positive deficit and zero savings on overspend', () => {
    const cats = [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')];
    const m = buildSankeyModel([row(1, 'income', '1000'), row(2, 'expense', '-1500')], cats, 'EUR');
    expect(m.deficit).toBe(500);
    expect(m.savings).toBe(0);
  });

  it('excludes internal-transfer, neutral, and uncategorized rows', () => {
    const cats = [cat(1, 'Salaire', 'income'), cat(2, 'Vir', 'expense', { isInternalTransfer: true }), cat(3, 'Neutre', 'neutral')];
    const rows = [
      row(1, 'income', '1000'),
      row(2, 'expense', '-500'),
      row(3, 'neutral', '-20'),
      row(null, null, '-40'),
    ];
    const m = buildSankeyModel(rows, cats, 'EUR');
    expect(m.totalExpense).toBe(0);
    expect(m.totalIncome).toBe(1000);
  });

  it('conserves flow: left total equals right total', () => {
    const cats = [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')];
    const m = buildSankeyModel([row(1, 'income', '3000'), row(2, 'expense', '-800')], cats, 'EUR');
    const left = m.totalIncome + m.deficit;
    const right = m.totalExpense + m.savings;
    expect(left).toBe(right);
  });

  it('excludes groups that net <= 0 (e.g., expense categories dominated by refunds)', () => {
    // Two expense roots: one positive (included), one that nets negative (excluded)
    const cats = [
      cat(1, 'Courses', 'expense'),
      cat(2, 'Remboursements', 'expense'),
    ];
    const rows = [
      row(1, 'expense', '-500.00'),  // Courses: 500 (positive, included)
      row(2, 'expense', '-100.00'),  // Remboursements charges: 100
      row(2, 'expense', '300.00'),   // Remboursements refunds: -300 (net: -200, excluded)
    ];
    const m = buildSankeyModel(rows, cats, 'EUR');
    // Only Courses should appear in expenseNodes
    expect(m.expenseNodes).toHaveLength(1);
    expect(m.expenseNodes[0]).toMatchObject({ label: 'Courses', amount: 500 });
    // totalExpense should only count the positive group
    expect(m.totalExpense).toBe(500);
  });
});
