import { describe, it, expect } from 'vitest';
import { resolveDisplayCurrency, buildConsolidatedBlock } from '../balance.js';

// These exercise the balance route's business logic (display-currency
// resolution + FX consolidation + response shaping) directly rather than
// through app.inject(). Full-app mocking of db/client + auth + the settings
// loader is brittle here: build() (src/buildServer.ts) registers ~25 route
// plugins, several of which install their own `requireAuth` preHandler hook
// that only exists once the real authPlugin decorates the app — replacing
// authPlugin with a no-op mock leaves `app.requireAuth` undefined for those
// hooks. Extracting the pure logic and testing it directly avoids that whole
// class of test-harness fragility while covering the same behavior.

describe('resolveDisplayCurrency', () => {
  it('returns the settings value when no query param is given', () => {
    expect(resolveDisplayCurrency(undefined, null)).toBeNull();
    expect(resolveDisplayCurrency(undefined, 'EUR')).toBe('EUR');
  });

  it('returns null (per-currency mode) for ?display=none', () => {
    expect(resolveDisplayCurrency('none', 'EUR')).toBeNull();
  });

  it('returns the requested code for a 3-letter uppercase param', () => {
    expect(resolveDisplayCurrency('USD', null)).toBe('USD');
  });

  it('returns "invalid" for anything else', () => {
    expect(resolveDisplayCurrency('usd', null)).toBe('invalid');
    expect(resolveDisplayCurrency('EU', null)).toBe('invalid');
    expect(resolveDisplayCurrency('EUROS', null)).toBe('invalid');
  });
});

describe('buildConsolidatedBlock', () => {
  const perCurrencyRows = [
    { currency: 'EUR', total: '100.00', available: '100.00', invested: '0.00', account_count: 1 },
    { currency: 'USD', total: '100.00', available: '50.00', invested: '0.00', account_count: 1 },
  ];
  const rates = [
    { fromCcy: 'USD', toCcy: 'EUR', effectiveFrom: '2020-01-01', rate: '0.9' },
  ];

  it('computes totals converted into the display currency', () => {
    const out = buildConsolidatedBlock(perCurrencyRows, 'EUR', rates, '2026-08-14');
    expect(out.display).toBe('EUR');
    expect(out.total).toBe('190.00');
    expect(out.available).toBe('145.00');
    expect(out.unmapped).toEqual([]);
  });

  it('lists rows with no applicable rate as unmapped, excluded from totals', () => {
    const out = buildConsolidatedBlock(perCurrencyRows, 'EUR', [], '2026-08-14');
    expect(out.total).toBe('100.00');
    expect(out.unmapped).toEqual([
      { currency: 'USD', total: '100.00', available: '50.00', invested: '0.00', account_count: 1 },
    ]);
  });
});
