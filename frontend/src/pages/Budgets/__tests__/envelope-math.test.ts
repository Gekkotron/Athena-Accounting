import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import { formatSignedMoney, computeTargetProgress } from '../envelope-math';
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
