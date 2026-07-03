import { describe, it, expect } from 'vitest';
import { buildAggregatedSeries } from '../series';
import type { BalancePoint } from '../../../api/types';

function p(bucket: string, cumulative: string, account_id = 1, currency = 'EUR'): BalancePoint {
  return { account_id, currency, bucket, delta: '0', cumulative };
}

describe('buildAggregatedSeries', () => {
  it('returns [] when there are no points for the requested currency', () => {
    expect(buildAggregatedSeries([], 'EUR')).toEqual([]);
    expect(buildAggregatedSeries([p('2024-01-01', '100', 1, 'USD')], 'EUR')).toEqual([]);
  });

  it('drops points with non-finite cumulative values', () => {
    const points: BalancePoint[] = [
      p('2024-01-01', 'NaN'),
      p('2024-01-02', 'not-a-number'),
    ];
    expect(buildAggregatedSeries(points, 'EUR')).toEqual([]);
  });

  it('produces one point per date bucket for a single account', () => {
    const points = [
      p('2024-01-01', '100'),
      p('2024-01-02', '150'),
    ];
    expect(buildAggregatedSeries(points, 'EUR')).toEqual([
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 150 },
    ]);
  });

  it('forward-fills accounts across dates where they had no activity', () => {
    // Account 1 posts on 01-01 and 01-03; account 2 only posts on 01-02.
    // On 01-02, account 1's carried value (100) must be included in the sum.
    // On 01-03, account 2's carried value (50) must be included in the sum.
    const points = [
      p('2024-01-01', '100', 1),
      p('2024-01-02', '50', 2),
      p('2024-01-03', '120', 1),
    ];
    expect(buildAggregatedSeries(points, 'EUR')).toEqual([
      { date: '2024-01-01', value: 100 },       // acc1=100, acc2=0
      { date: '2024-01-02', value: 100 + 50 },  // acc1 carried, acc2 new
      { date: '2024-01-03', value: 120 + 50 },  // acc1 new, acc2 carried
    ]);
  });

  it('filters out points of a different currency before aggregating', () => {
    const points = [
      p('2024-01-01', '100', 1, 'EUR'),
      p('2024-01-01', '9999', 2, 'USD'),   // dropped
      p('2024-01-02', '150', 1, 'EUR'),
    ];
    expect(buildAggregatedSeries(points, 'EUR')).toEqual([
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 150 },
    ]);
  });

  it('sorts buckets chronologically even when input is unordered', () => {
    const points = [
      p('2024-02-01', '200'),
      p('2024-01-01', '100'),
      p('2024-03-01', '300'),
    ];
    const out = buildAggregatedSeries(points, 'EUR');
    expect(out.map((d) => d.date)).toEqual([
      '2024-01-01', '2024-02-01', '2024-03-01',
    ]);
  });
});
