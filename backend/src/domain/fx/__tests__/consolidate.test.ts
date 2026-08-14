import { describe, it, expect } from 'vitest';
import { consolidate } from '../consolidate.js';
import type { FxRate } from '../types.js';

const R = (fromCcy: string, toCcy: string, effectiveFrom: string, rate: string): FxRate =>
  ({ fromCcy, toCcy, effectiveFrom, rate });

describe('consolidate', () => {
  const KEYS = ['total', 'available'] as const;

  it('converts every row when all rates exist', () => {
    const rows = [
      { currency: 'EUR', total: '100.00', available: '100.00' },
      { currency: 'USD', total: '100.00', available: '50.00' },
    ];
    const rates = [R('USD', 'EUR', '2026-01-01', '0.9')];
    const out = consolidate(rows, 'EUR', rates, '2026-06-01', KEYS);
    expect(out.display).toBe('EUR');
    expect(out.totals.total).toBe('190.00');
    expect(out.totals.available).toBe('145.00');
    expect(out.unmapped).toEqual([]);
  });

  it('lists unconverted rows under unmapped', () => {
    const rows = [
      { currency: 'EUR', total: '100.00', available: '100.00' },
      { currency: 'GBP', total: '50.00', available: '50.00' },
    ];
    const out = consolidate(rows, 'EUR', [], '2026-06-01', KEYS);
    expect(out.totals.total).toBe('100.00');
    expect(out.unmapped).toEqual([
      { currency: 'GBP', total: '50.00', available: '50.00' },
    ]);
  });

  it('short-circuits identity conversion without a rate row', () => {
    const rows = [{ currency: 'EUR', total: '100.00', available: '100.00' }];
    const out = consolidate(rows, 'EUR', [], '2026-06-01', KEYS);
    expect(out.totals.total).toBe('100.00');
    expect(out.unmapped).toEqual([]);
  });

  it('handles an empty perCurrency list', () => {
    const out = consolidate([], 'EUR', [], '2026-06-01', KEYS);
    expect(out.totals.total).toBe('0.00');
    expect(out.totals.available).toBe('0.00');
    expect(out.unmapped).toEqual([]);
  });

  it('quantizes to 2 decimals using half-up rounding', () => {
    const rows = [{ currency: 'USD', total: '100.005', available: '99.994' }];
    const rates = [R('USD', 'EUR', '2026-01-01', '1')];
    const out = consolidate(rows, 'EUR', rates, '2026-06-01', ['total', 'available'] as const);
    expect(out.totals.total).toBe('100.01');
    expect(out.totals.available).toBe('99.99');
  });
});
