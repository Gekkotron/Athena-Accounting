import { describe, it, expect } from 'vitest';
import { computeValuation } from '../gain.js';

describe('computeValuation', () => {
  it('investment with a valuation: value is the valuation, gain vs Versé', () => {
    expect(
      computeValuation({
        type: 'investment',
        currentBalance: '900.00',
        contributed: '1000.00',
        latestValue: '1100.00',
      }),
    ).toEqual({ value: '1100.00', gain: '100.00', gainPct: 0.1 });
  });

  it('investment without a valuation falls back to the book balance', () => {
    expect(
      computeValuation({
        type: 'investment',
        currentBalance: '950.00',
        contributed: '1000.00',
        latestValue: null,
      }),
    ).toEqual({ value: '950.00', gain: '-50.00', gainPct: -0.05 });
  });

  it('savings: value is the book balance and gain is the interest', () => {
    expect(
      computeValuation({
        type: 'savings',
        currentBalance: '1020.50',
        contributed: '1000.00',
        latestValue: null,
      }),
    ).toEqual({ value: '1020.50', gain: '20.50', gainPct: 0.0205 });
  });

  it('ignores a stray valuation on a non-investment account', () => {
    expect(
      computeValuation({
        type: 'savings',
        currentBalance: '500.00',
        contributed: '500.00',
        latestValue: '999.00',
      }).value,
    ).toBe('500.00');
  });

  it('checking: no Versé, no gain', () => {
    expect(
      computeValuation({
        type: 'checking',
        currentBalance: '42.10',
        contributed: null,
        latestValue: null,
      }),
    ).toEqual({ value: '42.10', gain: null, gainPct: null });
  });

  it('gainPct is null when Versé is zero or negative', () => {
    expect(
      computeValuation({ type: 'investment', currentBalance: '0.00', contributed: '0.00', latestValue: '50.00' }),
    ).toEqual({ value: '50.00', gain: '50.00', gainPct: null });
    expect(
      computeValuation({ type: 'investment', currentBalance: '0.00', contributed: '-10.00', latestValue: '5.00' })
        .gainPct,
    ).toBeNull();
  });

  it('rounds the ratio to 4 decimals', () => {
    expect(
      computeValuation({ type: 'investment', currentBalance: '0', contributed: '300.00', latestValue: '400.00' })
        .gainPct,
    ).toBe(0.3333);
  });
});
