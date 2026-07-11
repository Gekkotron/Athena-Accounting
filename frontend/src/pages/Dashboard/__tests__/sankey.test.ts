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

  it('skips rows with a non-numeric total instead of producing NaN', () => {
    const cats = [cat(1, 'Salaire', 'income')];
    const rows = [row(1, 'income', '1000'), row(1, 'income', 'not-a-number')];
    const m = buildSankeyModel(rows, cats, 'EUR');
    expect(m.totalIncome).toBe(1000);
    expect(Number.isFinite(m.totalIncome)).toBe(true);
  });
});

import { layoutSankey } from '../sankey';

describe('layoutSankey', () => {
  const model = buildSankeyModel(
    [row(1, 'income', '3000'), row(2, 'expense', '-800')],
    [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')],
    'EUR',
  );

  it('places three columns and a single center pool', () => {
    const { nodes } = layoutSankey(model, { width: 600, height: 300 });
    const cols = new Set(nodes.map((n) => n.column));
    expect(cols).toEqual(new Set(['left', 'center', 'right']));
    expect(nodes.filter((n) => n.column === 'center')).toHaveLength(1);
    expect(nodes.find((n) => n.column === 'center')!.key).toBe('pool');
  });

  it('emits a savings node on the right when there is surplus', () => {
    const { nodes } = layoutSankey(model, { width: 600, height: 300 });
    expect(nodes.find((n) => n.key === 'out:savings')).toBeTruthy();
    expect(nodes.find((n) => n.key === 'in:deficit')).toBeUndefined();
  });

  it('emits a deficit source on the left when overspending', () => {
    const deficitModel = buildSankeyModel(
      [row(1, 'income', '1000'), row(2, 'expense', '-1500')],
      [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')],
      'EUR',
    );
    const { nodes } = layoutSankey(deficitModel, { width: 600, height: 300 });
    expect(nodes.find((n) => n.key === 'in:deficit')).toBeTruthy();
    expect(nodes.find((n) => n.key === 'out:savings')).toBeUndefined();
  });

  it('produces only non-negative dimensions and positive link widths', () => {
    const { nodes, links } = layoutSankey(model, { width: 600, height: 300 });
    for (const n of nodes) { expect(n.w).toBeGreaterThan(0); expect(n.h).toBeGreaterThanOrEqual(0); }
    for (const l of links) { expect(l.width).toBeGreaterThan(0); expect(l.path).toMatch(/^M/); }
  });

  it('conserves height: left node heights sum ~= right node heights sum, even with unequal column node counts', () => {
    const { nodes } = layoutSankey(model, { width: 600, height: 300 });
    const sum = (col: string) => nodes.filter((n) => n.column === col).reduce((s, n) => s + n.h, 0);
    expect(nodes.filter((n) => n.column === 'left')).toHaveLength(1);
    expect(nodes.filter((n) => n.column === 'right')).toHaveLength(2);
    expect(Math.abs(sum('left') - sum('right'))).toBeLessThanOrEqual(1);
    for (const n of nodes) expect(n.h).toBeGreaterThanOrEqual(0);
  });

  it('labels the pool with total income (not grandTotal) in a deficit, while keeping full height', () => {
    const deficitModel = buildSankeyModel(
      [row(1, 'income', '1000'), row(2, 'expense', '-1500')],
      [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')],
      'EUR',
    );
    const layout = layoutSankey(deficitModel, { width: 600, height: 300 });
    const pool = layout.nodes.find((n) => n.key === 'pool')!;
    expect(pool.amount).toBe(deficitModel.totalIncome);
    expect(pool.amount).not.toBe(deficitModel.totalIncome + deficitModel.deficit);
    // Pool height tracks the layout height (which may have grown to accommodate
    // the min-floor on tiny nodes — here it stays at the requested 300).
    expect(pool.h).toBe(layout.height);
  });

  it('floors every non-pool node height to at least minNodeHeight so labels have room', () => {
    // Five expense categories, one at 1 % of income → naturally below min-floor.
    const cats = [
      cat(1, 'Salaire', 'income'),
      cat(2, 'Loyer', 'expense'),
      cat(3, 'Courses', 'expense'),
      cat(4, 'Transports', 'expense'),
      cat(5, 'Cadeaux', 'expense'),
      cat(6, 'Cafés', 'expense'),
    ];
    const rows = [
      row(1, 'income', '10000'),
      row(2, 'expense', '-5000'),
      row(3, 'expense', '-3000'),
      row(4, 'expense', '-1500'),
      row(5, 'expense', '-400'),
      row(6, 'expense', '-100'), // ~1 %, would be ~3 px without the floor
    ];
    const m = buildSankeyModel(rows, cats, 'EUR');
    const layout = layoutSankey(m, { width: 720, height: 360 });
    for (const n of layout.nodes) {
      if (n.key === 'pool') continue;
      expect(n.h).toBeGreaterThanOrEqual(24);
    }
  });

  it('grows layout.height when the min-floor bumps push a column past the requested height', () => {
    // Six thin expense nodes each get floored to 24 → 6*24 + 5*6 gaps = 174.
    // Plus the savings node. Requested height is small (100) — layout grows.
    const cats = [
      cat(1, 'Salaire', 'income'),
      ...Array.from({ length: 6 }, (_, i) => cat(2 + i, `Cat${i}`, 'expense' as const)),
    ];
    const rows = [
      row(1, 'income', '10000'),
      ...Array.from({ length: 6 }, (_, i) => row(2 + i, 'expense' as const, '-100')),
    ];
    const m = buildSankeyModel(rows, cats, 'EUR');
    const layout = layoutSankey(m, { width: 720, height: 100 });
    expect(layout.height).toBeGreaterThan(100);
  });

  it('keeps layout.height at the requested value when no node needs the floor', () => {
    // Two chunky nodes on each side, all well above 24 px at requested height.
    const cats = [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')];
    const rows = [row(1, 'income', '3000'), row(2, 'expense', '-1000')];
    const m = buildSankeyModel(rows, cats, 'EUR');
    const layout = layoutSankey(m, { width: 720, height: 360 });
    expect(layout.height).toBe(360);
  });
});
