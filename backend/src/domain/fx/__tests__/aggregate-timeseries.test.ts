import { describe, it, expect } from 'vitest';
import { aggregateTimeseriesByBucket } from '../aggregate-timeseries.js';

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
