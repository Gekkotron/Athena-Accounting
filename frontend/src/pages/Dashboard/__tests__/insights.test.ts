import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import { buildInsights, monthLabel } from '../insights';
import type { Category, CategoryReportRow, BudgetReportRow } from '../../../api/types';
import frDashboard from '../../../locales/fr/dashboard.json';
import { pinLocale } from '../../../test/i18n';

// buildInsights formats amounts via lib/format's formatAmount, which is now
// locale-aware via the shared i18n singleton — pin it to 'fr' so the
// Intl.NumberFormat output here matches the FR assertions below regardless
// of the environment's default detected language.
pinLocale('dashboard');

function row(p: Partial<CategoryReportRow>): CategoryReportRow {
  return {
    category_id: null,
    category_name: null,
    category_kind: null,
    category_is_internal_transfer: false,
    month: '2026-06',
    total: '0',
    transaction_count: 0,
    ...p,
  };
}

const MONTHS = ['2026-04', '2026-05', '2026-06'];
const REF = '2026-06';

// buildInsights takes a real i18next `t` — rather than hand-rolling fake
// French strings here (which would drift from the actual translation file),
// spin up a standalone i18next instance loaded with the same fr/dashboard.json
// bundle the app ships, and get a fixed translator off it. `initImmediate:
// false` makes `.init()` resolve synchronously so no `await` is needed.
const testI18n = i18next.createInstance();
testI18n.init({
  lng: 'fr',
  resources: { fr: { dashboard: frDashboard } },
  interpolation: { escapeValue: false },
  initImmediate: false,
});
const t = testI18n.getFixedT('fr', 'dashboard');

function build(rows: CategoryReportRow[], budgets: BudgetReportRow[] = [], categories: Category[] = []) {
  return buildInsights(rows, categories, budgets, MONTHS, REF, 'EUR', t, 'fr');
}

describe('monthLabel', () => {
  it('maps a YYYY-MM key to a lower-case French month', () => {
    expect(monthLabel('2026-06')).toBe('juin');
  });
});

describe('buildInsights — spend/income delta', () => {
  it('emits a notable spend-delta when spend rises >= 10% vs the prior month', () => {
    const rows = [
      row({ category_id: 1, category_name: 'Courses', month: '2026-05', total: '-1000.00' }),
      row({ category_id: 1, category_name: 'Courses', month: '2026-06', total: '-1200.00' }),
    ];
    const out = build(rows);
    const spend = out.find((i) => i.key === 'spend-delta');
    expect(spend).toBeDefined();
    expect(spend!.headline).toContain('juin');
    expect(spend!.detail).toContain('+20,0 %');
    expect(spend!.detail).toContain('mai');
    expect(spend!.tone).toBe('clay'); // spending more is unfavourable
    expect(spend!.spark).toBeDefined();
  });

  it('does NOT emit spend-delta when the change is under the threshold', () => {
    const rows = [
      row({ category_id: 1, month: '2026-05', total: '-1000.00' }),
      row({ category_id: 1, month: '2026-06', total: '-1050.00' }), // +5%
    ];
    expect(build(rows).some((i) => i.key === 'spend-delta')).toBe(false);
  });

  it('emits a notable income-delta with sage tone when income rises', () => {
    const rows = [
      row({ category_id: 2, category_name: 'Salaire', category_kind: 'income', month: '2026-05', total: '2000.00' }),
      row({ category_id: 2, category_name: 'Salaire', category_kind: 'income', month: '2026-06', total: '2400.00' }), // +20%
    ];
    const income = build(rows).find((i) => i.key === 'income-delta');
    expect(income).toBeDefined();
    expect(income!.tone).toBe('sage');
    expect(income!.headline).toContain('Vos revenus');
  });

  it('counts income-kind categories only — a positive refund in a non-income category is not revenue', () => {
    const rows = [
      // A refund posted to an expense category: positive, but not revenue.
      row({ category_id: 7, category_name: 'Remboursement', category_kind: 'expense', month: '2026-05', total: '800.00' }),
      row({ category_id: 7, category_name: 'Remboursement', category_kind: 'expense', month: '2026-06', total: '1200.00' }), // +50%
    ];
    // No income-kind rows → no income-delta despite the positive swing.
    expect(build(rows).some((i) => i.key === 'income-delta')).toBe(false);
  });

  it('skips internal-transfer and non-finite rows', () => {
    const rows = [
      row({ category_id: 3, month: '2026-05', total: '-1000.00', category_is_internal_transfer: true }),
      row({ category_id: 3, month: '2026-06', total: '-2000.00', category_is_internal_transfer: true }),
      row({ category_id: 4, month: '2026-06', total: 'not-a-number' }),
    ];
    expect(build(rows)).toHaveLength(0);
  });

  it('returns at most TOP_N (4) insights', () => {
    // Big swings in many categories → more than 4 candidates.
    const rows = [
      row({ category_id: 1, category_name: 'A', month: '2026-05', total: '-1000.00' }),
      row({ category_id: 1, category_name: 'A', month: '2026-06', total: '-3000.00' }),
      row({ category_id: 5, category_name: 'Salaire', category_kind: 'income', month: '2026-05', total: '1000.00' }),
      row({ category_id: 5, category_name: 'Salaire', category_kind: 'income', month: '2026-06', total: '3000.00' }),
    ];
    expect(build(rows).length).toBeLessThanOrEqual(4);
  });
});

describe('buildInsights — savings', () => {
  it('flags a month where spending exceeded income with the top score', () => {
    const rows = [
      row({ category_id: 2, category_name: 'Salaire', category_kind: 'income', month: '2026-06', total: '500.00' }),
      row({ category_id: 1, category_name: 'Courses', month: '2026-06', total: '-1000.00' }),
    ];
    const out = build(rows);
    const savings = out.find((i) => i.key === 'savings');
    expect(savings).toBeDefined();
    expect(savings!.icon).toBe('⚠️');
    expect(savings!.headline).toContain('plus que vos revenus');
    expect(savings!.tone).toBe('clay');
    expect(savings!.score).toBe(100);
  });

  it('does not emit a savings insight when the rate is near the historical average', () => {
    // Same 50% savings rate every month → deviation 0 → not notable.
    const rows = [
      row({ category_id: 2, category_kind: 'income', month: '2026-04', total: '2000.00' }),
      row({ category_id: 1, month: '2026-04', total: '-1000.00' }),
      row({ category_id: 2, category_kind: 'income', month: '2026-05', total: '2000.00' }),
      row({ category_id: 1, month: '2026-05', total: '-1000.00' }),
      row({ category_id: 2, category_kind: 'income', month: '2026-06', total: '2000.00' }),
      row({ category_id: 1, month: '2026-06', total: '-1000.00' }),
    ];
    expect(build(rows).some((i) => i.key === 'savings')).toBe(false);
  });
});

describe('buildInsights — category movers', () => {
  it('picks the largest spend increase and formats the delta', () => {
    const rows = [
      row({ category_id: 1, category_name: 'Restaurants', month: '2026-05', total: '-400.00' }),
      row({ category_id: 1, category_name: 'Restaurants', month: '2026-06', total: '-550.00' }), // +150 (+37.5%)
      row({ category_id: 2, category_name: 'Courses', month: '2026-05', total: '-1000.00' }),
      row({ category_id: 2, category_name: 'Courses', month: '2026-06', total: '-1020.00' }), // +20 (+2%) — below thresholds
    ];
    const inc = build(rows).find((i) => i.key === 'top-increase');
    expect(inc).toBeDefined();
    expect(inc!.headline).toContain('Restaurants');
    expect(inc!.detail).toContain('+150,00');
    expect(inc!.detail).toContain('+37,5 %');
    expect(inc!.tone).toBe('clay');
  });

  it('labels a from-zero category as "nouveau"', () => {
    const rows = [
      row({ category_id: 9, category_name: 'Vacances', month: '2026-06', total: '-300.00' }), // prev 0
    ];
    const inc = build(rows).find((i) => i.key === 'top-increase');
    expect(inc).toBeDefined();
    expect(inc!.detail).toBe('nouveau');
    expect(inc!.score).toBe(100); // capped
  });

  it('picks the largest spend decrease with sage tone', () => {
    const rows = [
      row({ category_id: 3, category_name: 'Essence', month: '2026-05', total: '-300.00' }),
      row({ category_id: 3, category_name: 'Essence', month: '2026-06', total: '-100.00' }), // -200 (-66.7%)
    ];
    const dec = build(rows).find((i) => i.key === 'top-decrease');
    expect(dec).toBeDefined();
    expect(dec!.headline).toContain('Essence');
    expect(dec!.detail).toContain('-200,00');
    expect(dec!.tone).toBe('sage');
  });

  it('ignores movers below the absolute floor', () => {
    const rows = [
      row({ category_id: 4, category_name: 'Café', month: '2026-05', total: '-10.00' }),
      row({ category_id: 4, category_name: 'Café', month: '2026-06', total: '-45.00' }), // +35 (>30% but < 50€ floor)
    ];
    expect(build(rows).some((i) => i.key === 'top-increase')).toBe(false);
  });

  it('ranks top category movers at the root level', () => {
    const cats: Category[] = [
      { id: 1, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
      { id: 2, name: 'Alimentation', kind: 'expense', color: null, parentId: 1, isDefault: false, isInternalTransfer: false },
      { id: 3, name: 'Ménage', kind: 'expense', color: null, parentId: 1, isDefault: false, isInternalTransfer: false },
      { id: 4, name: 'Loisirs', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
    ];
    // Two leaves of Courses both went up modestly. Loisirs went up a bit more than either
    // leaf alone, but less than Courses's rollup — so Courses should be the top mover.
    const rows = [
      row({ category_id: 2, category_kind: 'expense', month: '2026-05', total: '-300' }),
      row({ category_id: 3, category_kind: 'expense', month: '2026-05', total: '-100' }),
      row({ category_id: 2, category_kind: 'expense', month: '2026-06', total: '-400' }),
      row({ category_id: 3, category_kind: 'expense', month: '2026-06', total: '-200' }),
      row({ category_id: 4, category_kind: 'expense', month: '2026-05', total: '-500' }),
      row({ category_id: 4, category_kind: 'expense', month: '2026-06', total: '-650' }),
    ];
    const insights = build(rows, [], cats);
    const topMover = insights.find((i) => i.headline?.startsWith('Plus forte hausse'));
    expect(topMover?.headline).toBe('Plus forte hausse : Courses');
  });
});

function budgetRow(p: Partial<BudgetReportRow>): BudgetReportRow {
  return {
    id: 1,
    categoryId: 1,
    name: 'Cat',
    color: null,
    parentId: null,
    accountId: null,
    period: 'monthly',
    limit: '100.00',
    currency: 'EUR',
    spent: '0.00',
    remaining: '100.00',
    pct: 0,
    over: false,
    projected: null,
    history: null,
    anomaly: false,
    suggestedLimit: null,
    ...p,
  };
}

describe('buildInsights — budget overruns', () => {
  it('counts only over-budget rows and lists their names', () => {
    const budgets = [
      budgetRow({ categoryId: 1, name: 'Courses', over: true }),
      budgetRow({ categoryId: 2, name: 'Loisirs', over: true }),
      budgetRow({ categoryId: 3, name: 'Transport', over: false }),
    ];
    const out = build([], budgets);
    const b = out.find((i) => i.key === 'budget-overruns');
    expect(b).toBeDefined();
    expect(b!.headline).toContain('2 budgets dépassés');
    expect(b!.detail).toContain('Courses');
    expect(b!.detail).toContain('Loisirs');
    expect(b!.detail).not.toContain('Transport');
    expect(b!.tone).toBe('clay');
  });

  it('emits no budget insight when nothing is over budget', () => {
    expect(build([], [budgetRow({ over: false })]).some((i) => i.key === 'budget-overruns')).toBe(false);
  });

  it('returns an empty array when no insight clears its threshold', () => {
    expect(build([])).toEqual([]);
  });
});
