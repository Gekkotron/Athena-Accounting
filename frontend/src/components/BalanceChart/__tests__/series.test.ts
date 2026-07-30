import { describe, it, expect } from 'vitest';
import { buildAggregatedSeries, withCarriedBaselines } from '../series';
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

describe('withCarriedBaselines', () => {
  it('returns points unchanged when fromDate is undefined (range "Tout")', () => {
    const points = [p('2024-01-01', '100'), p('2024-06-01', '200')];
    expect(withCarriedBaselines(points, undefined)).toEqual(points);
  });

  it('keeps in-window points and drops pre-window ones for active accounts', () => {
    const points = [
      p('2024-01-01', '100'),
      p('2024-06-10', '150'),
    ];
    const out = withCarriedBaselines(points, '2024-06-01');
    expect(out).toContainEqual(p('2024-06-10', '150'));
    expect(out.some((q) => q.bucket === '2024-01-01')).toBe(false);
  });

  it('injects a baseline at the window start carrying the last pre-window cumulative', () => {
    const points = [
      p('2024-01-01', '100'),
      p('2024-03-01', '180'),
      p('2024-06-10', '150'),
    ];
    const out = withCarriedBaselines(points, '2024-06-01');
    expect(out).toContainEqual({ ...p('2024-06-01', '180'), delta: '0' });
  });

  it('an account quiet inside the window still contributes its carried balance', () => {
    // Account 2 (savings) last moved in February — before, it vanished from
    // the aggregate entirely and dragged the total toward zero.
    const points = [
      p('2024-02-15', '10000', 2),
      p('2024-06-10', '150', 1),
    ];
    const out = withCarriedBaselines(points, '2024-06-01');
    const agg = buildAggregatedSeries(out, 'EUR');
    expect(agg[agg.length - 1]).toEqual({ date: '2024-06-10', value: 150 + 10000 });
  });

  it('does not inject a baseline when the account has a bucket exactly at the window start', () => {
    const points = [
      p('2024-05-20', '80'),
      p('2024-06-01', '120'),
    ];
    const out = withCarriedBaselines(points, '2024-06-01');
    expect(out.filter((q) => q.bucket === '2024-06-01')).toHaveLength(1);
    expect(out).toContainEqual(p('2024-06-01', '120'));
  });

  it('leaves accounts with no pre-window history untouched', () => {
    const points = [p('2024-06-10', '150')];
    expect(withCarriedBaselines(points, '2024-06-01')).toEqual(points);
  });
});
