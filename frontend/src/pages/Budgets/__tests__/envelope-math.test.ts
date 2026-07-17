import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import {
  formatSignedMoney,
  computeTargetProgress,
  suggestedAssignmentDelta,
  distributePoolAcrossEnvelopes,
} from '../envelope-math';
import type { EnvelopeReportRow } from '../../../api/types';
import frBudgets from '../../../locales/fr/budgets.json';
import { pinLocale } from '../../../test/i18n';

// formatSignedMoney delegates to lib/format's formatAmount, which is now
// locale-aware via the shared i18n singleton — pin it to 'fr' so the
// Intl.NumberFormat output here matches the FR assertions below regardless
// of the environment's default detected language.
pinLocale('budgets');

// computeTargetProgress takes a real i18next `t` — rather than hand-rolling
// fake French strings here (which would drift from the actual translation
// file), spin up a standalone i18next instance loaded with the same
// fr/budgets.json bundle the app ships, and get a fixed translator off it.
// `initImmediate: false` makes `.init()` resolve synchronously so no
// `await` is needed. Mirrors Dashboard/__tests__/insights.test.ts.
const testI18n = i18next.createInstance();
testI18n.init({
  lng: 'fr',
  resources: { fr: { budgets: frBudgets } },
  interpolation: { escapeValue: false },
  initImmediate: false,
});
const t = testI18n.getFixedT('fr', 'budgets');

describe('formatSignedMoney', () => {
  it('formats positive with regular sign', () => {
    expect(formatSignedMoney('12.50')).toBe('12,50 €');
  });
  it('keeps the minus for negatives', () => {
    // U+2212 minus sign, U+00A0 non-breaking space (what Intl.NumberFormat('fr-FR') actually emits).
    expect(formatSignedMoney('-65.00')).toBe('−65,00 €');
  });
});

describe('computeTargetProgress', () => {
  it('returns null when no target', () => {
    expect(computeTargetProgress({ target: null, balance: '10.00', assignment: '0.00' }, t)).toBeNull();
  });
  it('save_by_date uses balance / amount', () => {
    const result = computeTargetProgress({
      target: { amount: '1200.00', date: '2026-12-01', kind: 'save_by_date' },
      balance: '700.00', assignment: '100.00',
    }, t)!;
    expect(result.pct).toBeCloseTo(700 / 1200, 3);
    expect(result.label).toContain("d'ici 2026-12-01");
  });
  it('monthly_recurring uses assignment / amount', () => {
    const result = computeTargetProgress({
      target: { amount: '500.00', date: null, kind: 'monthly_recurring' },
      balance: '0.00', assignment: '450.00',
    }, t)!;
    expect(result.pct).toBeCloseTo(450 / 500, 3);
    expect(result.label).toContain('/mois');
  });
});

describe('suggestedAssignmentDelta', () => {
  it('returns 0 without a target', () => {
    expect(suggestedAssignmentDelta(
      { target: null, balance: '0.00', assignment: '0.00' },
      '2026-07',
    )).toBe(0);
  });
  it('monthly_recurring — tops up to the recurring amount', () => {
    expect(suggestedAssignmentDelta(
      { target: { amount: '300.00', date: null, kind: 'monthly_recurring' },
        balance: '0.00', assignment: '120.00' },
      '2026-07',
    )).toBeCloseTo(180, 3);
  });
  it('monthly_recurring — 0 when assignment already meets target', () => {
    expect(suggestedAssignmentDelta(
      { target: { amount: '300.00', date: null, kind: 'monthly_recurring' },
        balance: '0.00', assignment: '400.00' },
      '2026-07',
    )).toBe(0);
  });
  it('save_up_to — fills to target in one shot', () => {
    expect(suggestedAssignmentDelta(
      { target: { amount: '500.00', date: null, kind: 'save_up_to' },
        balance: '200.00', assignment: '0.00' },
      '2026-07',
    )).toBeCloseTo(300, 3);
  });
  it('save_by_date — divides shortfall by inclusive month count', () => {
    // July 2026 → September 2026 = 3 months. Balance 100, target 1300 → 400/mo.
    expect(suggestedAssignmentDelta(
      { target: { amount: '1300.00', date: '2026-09-01', kind: 'save_by_date' },
        balance: '100.00', assignment: '0.00' },
      '2026-07',
    )).toBeCloseTo(400, 3);
  });
  it('save_by_date — clamps monthsRemaining ≥ 1 past the deadline', () => {
    expect(suggestedAssignmentDelta(
      { target: { amount: '1300.00', date: '2026-09-01', kind: 'save_by_date' },
        balance: '100.00', assignment: '0.00' },
      '2027-01',
    )).toBeCloseTo(1200, 3);
  });
  it('save_by_date — 0 when balance already meets target', () => {
    expect(suggestedAssignmentDelta(
      { target: { amount: '1000.00', date: '2026-12-01', kind: 'save_by_date' },
        balance: '1050.00', assignment: '0.00' },
      '2026-07',
    )).toBe(0);
  });
});

describe('distributePoolAcrossEnvelopes', () => {
  const baseRow = (over: Partial<EnvelopeReportRow>): EnvelopeReportRow => ({
    categoryId: 0, categoryName: 'x',
    balancePriorMonth: '0.00', assignment: '0.00',
    spend: '0.00', balance: '0.00',
    target: null, overspendPolicy: 'rollover_negative',
    overspent: false, absorbedByPool: '0.00', monthsToTarget: null,
    ...over,
  });

  it('returns [] when pool ≤ 0', () => {
    expect(distributePoolAcrossEnvelopes([], '0.00', '2026-07')).toEqual([]);
    expect(distributePoolAcrossEnvelopes([], '-10.00', '2026-07')).toEqual([]);
  });

  it('funds each envelope up to its delta while pool holds', () => {
    const rows = [
      baseRow({ categoryId: 1, target: { amount: '300.00', date: null, kind: 'monthly_recurring' } }),
      baseRow({ categoryId: 2, target: { amount: '500.00', date: null, kind: 'save_up_to' }, balance: '0.00' }),
    ];
    // Pool of 1000 covers both fully (300 + 500 = 800).
    expect(distributePoolAcrossEnvelopes(rows, '1000.00', '2026-07')).toEqual([
      { categoryId: 1, amount: '300.00' },
      { categoryId: 2, amount: '500.00' },
    ]);
  });

  it('grants a partial amount to the last envelope when pool is exhausted', () => {
    const rows = [
      baseRow({ categoryId: 1, target: { amount: '300.00', date: null, kind: 'monthly_recurring' } }),
      baseRow({ categoryId: 2, target: { amount: '500.00', date: null, kind: 'save_up_to' } }),
    ];
    // Pool of 400 → cat 1 gets 300, cat 2 gets 100 (partial), stops there.
    expect(distributePoolAcrossEnvelopes(rows, '400.00', '2026-07')).toEqual([
      { categoryId: 1, amount: '300.00' },
      { categoryId: 2, amount: '100.00' },
    ]);
  });

  it('skips envelopes without a target', () => {
    const rows = [
      baseRow({ categoryId: 1 }),
      baseRow({ categoryId: 2, target: { amount: '200.00', date: null, kind: 'save_up_to' } }),
    ];
    expect(distributePoolAcrossEnvelopes(rows, '1000.00', '2026-07')).toEqual([
      { categoryId: 2, amount: '200.00' },
    ]);
  });
});
