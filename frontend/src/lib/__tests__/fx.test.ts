// Mirrors backend/src/domain/fx/__tests__/{resolve-rate,consolidate,
// aggregate-timeseries}.test.ts — same cases, same fixtures — so drift
// between the two copies of frontend/src/lib/fx.ts and its backend
// counterpart shows up as a failing test on either side.
import { describe, it, expect } from 'vitest';
import { resolveRate, consolidate, aggregateTimeseriesByBucket } from '../fx';
import type { FxRate } from '../fx';

const R = (fromCcy: string, toCcy: string, effectiveFrom: string, rate: string): FxRate =>
  ({ fromCcy, toCcy, effectiveFrom, rate });

describe('resolveRate', () => {
  it('returns 1 when from === to', () => {
    expect(resolveRate([], 'EUR', 'EUR', '2026-01-01')).toBe(1);
  });

  it('finds an exact-date rate', () => {
    const rates = [R('USD', 'EUR', '2026-01-01', '0.9')];
    expect(resolveRate(rates, 'USD', 'EUR', '2026-01-01')).toBe(0.9);
  });

  it('finds the most recent rate on or before the target date', () => {
    const rates = [
      R('USD', 'EUR', '2026-01-01', '0.9'),
      R('USD', 'EUR', '2026-06-01', '0.85'),
    ];
    expect(resolveRate(rates, 'USD', 'EUR', '2026-03-15')).toBe(0.9);
    expect(resolveRate(rates, 'USD', 'EUR', '2026-07-01')).toBe(0.85);
  });

  it('returns null when no rate exists for the pair', () => {
    expect(resolveRate([], 'USD', 'EUR', '2026-01-01')).toBeNull();
  });

  it('returns null when all effective dates are after the target', () => {
    const rates = [R('USD', 'EUR', '2026-06-01', '0.85')];
    expect(resolveRate(rates, 'USD', 'EUR', '2026-01-01')).toBeNull();
  });

  it('does not derive the reverse pair from a stored (from,to) row', () => {
    const rates = [R('USD', 'EUR', '2026-01-01', '0.9')];
    expect(resolveRate(rates, 'EUR', 'USD', '2026-01-01')).toBeNull();
  });
});

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

describe('aggregateTimeseriesByBucket', () => {
  it('sums converted balances into one series per bucket', () => {
    const points = [
      { currency: 'EUR', bucket: '2026-01-01', cumulative: '100.00' },
      { currency: 'USD', bucket: '2026-01-01', cumulative: '100.00' },
      { currency: 'EUR', bucket: '2026-02-01', cumulative: '110.00' },
      { currency: 'USD', bucket: '2026-02-01', cumulative: '100.00' },
    ];
    const rates = [
      { fromCcy: 'USD', toCcy: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9' },
      { fromCcy: 'USD', toCcy: 'EUR', effectiveFrom: '2026-02-01', rate: '1.0' },
    ];
    const out = aggregateTimeseriesByBucket(points, 'EUR', rates);
    expect(out).toEqual([
      { bucket: '2026-01-01', total: '190.00', unmapped: [] },
      { bucket: '2026-02-01', total: '210.00', unmapped: [] },
    ]);
  });

  it('uses the rate effective at the bucket date (historical stability)', () => {
    const points = [{ currency: 'USD', bucket: '2026-01-15', cumulative: '100.00' }];
    const rates = [
      { fromCcy: 'USD', toCcy: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9' },
      { fromCcy: 'USD', toCcy: 'EUR', effectiveFrom: '2026-06-01', rate: '0.5' },
    ];
    const out = aggregateTimeseriesByBucket(points, 'EUR', rates);
    expect(out[0]!.total).toBe('90.00');
  });

  it('lists unmapped currencies per bucket without dropping the point', () => {
    const points = [
      { currency: 'EUR', bucket: '2026-01-01', cumulative: '100.00' },
      { currency: 'GBP', bucket: '2026-01-01', cumulative: '50.00' },
    ];
    const out = aggregateTimeseriesByBucket(points, 'EUR', []);
    expect(out[0]!.total).toBe('100.00');
    expect(out[0]!.unmapped).toEqual(['GBP']);
  });
});
