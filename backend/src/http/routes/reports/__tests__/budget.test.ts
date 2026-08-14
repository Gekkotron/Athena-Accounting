import { describe, it, expect } from 'vitest';
import { buildBudgetConsolidatedBlock } from '../budget.js';
import { resolveDisplayCurrency } from '../balance.js';

// Exercises the budget route's FX-consolidation glue directly rather than
// through app.inject() — see balance.test.ts for why: full-app mocking of
// db/client + auth is brittle across the ~25 registered route plugins.
// Extracting `buildBudgetConsolidatedBlock` as a pure function avoids that
// whole class of test-harness fragility.

describe('buildBudgetConsolidatedBlock', () => {
  const rates = [
    { fromCcy: 'USD', toCcy: 'EUR', effectiveFrom: '2020-01-01', rate: '0.9' },
  ];

  it('consolidates rows that are all the same currency', () => {
    const rows = [
      { currency: 'EUR', limit: '100.00', spent: '40.00', remaining: '60.00', projected: '80.00' },
      { currency: 'EUR', limit: '50.00', spent: '10.00', remaining: '40.00', projected: '20.00' },
    ];
    const out = buildBudgetConsolidatedBlock(rows, 'EUR', rates, '2026-08-14');
    expect(out.display).toBe('EUR');
    expect(out.totals).toEqual({
      limit: '150.00',
      spent: '50.00',
      remaining: '100.00',
      projected: '100.00',
    });
    expect(out.unmapped).toEqual([]);
  });

  it('consolidates mixed currencies when a rate is present for both', () => {
    const rows = [
      { currency: 'EUR', limit: '100.00', spent: '40.00', remaining: '60.00', projected: '80.00' },
      { currency: 'USD', limit: '100.00', spent: '50.00', remaining: '50.00', projected: '100.00' },
    ];
    const out = buildBudgetConsolidatedBlock(rows, 'EUR', rates, '2026-08-14');
    // USD row converted at 0.9: limit 90, spent 45, remaining 45, projected 90.
    expect(out.totals).toEqual({
      limit: '190.00',
      spent: '85.00',
      remaining: '105.00',
      projected: '170.00',
    });
    expect(out.unmapped).toEqual([]);
  });

  it('lists a currency with no applicable rate as unmapped, excluded from totals and projected', () => {
    const rows = [
      { currency: 'EUR', limit: '100.00', spent: '40.00', remaining: '60.00', projected: '80.00' },
      { currency: 'GBP', limit: '30.00', spent: '10.00', remaining: '20.00', projected: '25.00' },
    ];
    const out = buildBudgetConsolidatedBlock(rows, 'EUR', rates, '2026-08-14');
    expect(out.totals).toEqual({
      limit: '100.00',
      spent: '40.00',
      remaining: '60.00',
      projected: null,
    });
    expect(out.unmapped).toEqual([
      { currency: 'GBP', limit: '30.00', spent: '10.00', remaining: '20.00', projected: '25.00' },
    ]);
  });

  it('poisons the consolidated projected total when any row in a currency has a null projected', () => {
    const rows = [
      { currency: 'EUR', limit: '100.00', spent: '40.00', remaining: '60.00', projected: '80.00' },
      { currency: 'EUR', limit: '20.00', spent: '5.00', remaining: '15.00', projected: null },
    ];
    const out = buildBudgetConsolidatedBlock(rows, 'EUR', rates, '2026-08-14');
    expect(out.totals.limit).toBe('120.00');
    expect(out.totals.spent).toBe('45.00');
    expect(out.totals.remaining).toBe('75.00');
    expect(out.totals.projected).toBeNull();
    expect(out.unmapped).toEqual([]);
  });

  it('returns zeroed totals and no unmapped rows for an empty rows array', () => {
    const out = buildBudgetConsolidatedBlock([], 'EUR', rates, '2026-08-14');
    expect(out.display).toBe('EUR');
    expect(out.totals).toEqual({
      limit: '0.00',
      spent: '0.00',
      remaining: '0.00',
      projected: '0.00',
    });
    expect(out.unmapped).toEqual([]);
  });
});

describe('resolveDisplayCurrency wiring for budget route', () => {
  it('returns null (per-currency mode) when no query param and no setting', () => {
    expect(resolveDisplayCurrency(undefined, null)).toBeNull();
  });

  it('falls back to the settings value when no query param is given', () => {
    expect(resolveDisplayCurrency(undefined, 'EUR')).toBe('EUR');
  });

  it('returns null (per-currency mode) for an explicit ?display=none override', () => {
    expect(resolveDisplayCurrency('none', 'EUR')).toBeNull();
  });

  it('lets an explicit query param win over the settings value', () => {
    expect(resolveDisplayCurrency('EUR', null)).toBe('EUR');
  });

  it('rejects a lowercase display param as invalid', () => {
    expect(resolveDisplayCurrency('eur', null)).toBe('invalid');
  });
});
