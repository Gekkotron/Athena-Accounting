import { describe, it, expect } from 'vitest';
import { resolveDisplayCurrency } from '../balance.js';
import { aggregateTimeseriesByBucket } from '../../../../domain/fx/aggregate-timeseries.js';

// Exercises the timeseries route's business logic (display-currency
// resolution + FX aggregation) directly rather than through app.inject().
// See balance.test.ts for why: full-app mocking of db/client + auth is
// brittle because several route plugins install their own `requireAuth`
// preHandler hook that only exists once the real authPlugin decorates the
// app. Extracting and testing the pure logic avoids that class of
// test-harness fragility while covering the same behavior.

describe('timeseries display resolution + consolidation glue', () => {
  const points = [
    { account_id: 1, currency: 'EUR', bucket: '2026-01-01', delta: '100.00', cumulative: '100.00' },
    { account_id: 2, currency: 'USD', bucket: '2026-01-01', delta: '100.00', cumulative: '100.00' },
  ];
  const rates = [
    { fromCcy: 'USD', toCcy: 'EUR', effectiveFrom: '2020-01-01', rate: '0.9' },
  ];

  it('resolves the requested display currency from the query param', () => {
    expect(resolveDisplayCurrency('EUR', null)).toBe('EUR');
  });

  it('builds a consolidated block matching the pure aggregator output', () => {
    const resolved = resolveDisplayCurrency('EUR', null);
    expect(resolved).toBe('EUR');
    const aggregated = aggregateTimeseriesByBucket(points, resolved as string, rates);
    expect(aggregated).toEqual(aggregateTimeseriesByBucket(points, 'EUR', rates));
    expect(aggregated).toEqual([
      { bucket: '2026-01-01', total: '190.00', unmapped: [] },
    ]);
  });

  it('yields no consolidated block for ?display=none', () => {
    expect(resolveDisplayCurrency('none', 'EUR')).toBeNull();
  });

  it('rejects an invalid display param', () => {
    expect(resolveDisplayCurrency('eur', null)).toBe('invalid');
  });
});
