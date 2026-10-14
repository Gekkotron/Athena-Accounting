import { describe, it, expect } from 'vitest';
import { buildGainAreas, buildStepPath, buildValueSegments, computePlacementRange } from '../placements/geometry';
import { granularityFor, pickPlacementSeries, summarizePlacements, type PlacementPoint } from '../placements/series';

const pt = (date: string, contributed: number, value: number, estimated = false): PlacementPoint => ({
  date, contributed, value, gain: value - contributed, estimated, unmapped: [],
});
// x = index * 10, y = identity so coordinates are easy to read.
const x = (i: number) => i * 10;
const y = (v: number) => v;

describe('pickPlacementSeries', () => {
  const data = {
    points: [
      { currency: 'EUR', bucket: '2026-01-01', contributed: '100.00', value: '110.00', gain: '10.00', estimated: false },
      { currency: 'USD', bucket: '2026-01-01', contributed: '50.00', value: '40.00', gain: '-10.00', estimated: true },
    ],
    consolidated: null,
  };
  it('prefers the consolidated block', () => {
    const s = pickPlacementSeries({
      ...data,
      consolidated: { display: 'EUR', points: [{ bucket: '2026-01-01', contributed: '1', value: '2', gain: '1', estimated: true, unmapped: ['CHF'] }] },
    }, 'USD')!;
    expect(s.currency).toBe('EUR');
    expect(s.points[0]).toMatchObject({ date: '2026-01-01', value: 2, estimated: true, unmapped: ['CHF'] });
  });
  it('falls back to the preferred currency, else the first', () => {
    expect(pickPlacementSeries(data, 'USD')!.points).toHaveLength(1);
    expect(pickPlacementSeries(data, 'USD')!.currency).toBe('USD');
    expect(pickPlacementSeries(data, 'GBP')!.currency).toBe('EUR');
  });
  it('returns null without data', () => {
    expect(pickPlacementSeries(undefined, 'EUR')).toBeNull();
    expect(pickPlacementSeries({ points: [], consolidated: null }, 'EUR')).toBeNull();
  });
});

describe('summarizePlacements / granularityFor', () => {
  it('summarises the last point with a gain ratio', () => {
    expect(summarizePlacements([pt('a', 100, 100), pt('b', 200, 210)])).toEqual({ value: 210, contributed: 200, gain: 10, gainPct: 0.05 });
  });
  it('gainPct is null when nothing was contributed; empty yields null', () => {
    expect(summarizePlacements([pt('a', 0, 5)])!.gainPct).toBeNull();
    expect(summarizePlacements([])).toBeNull();
  });
  it('uses monthly buckets only for long ranges', () => {
    expect(['1m', '3m', '6m', '12m', 'all'].map(granularityFor)).toEqual(['day', 'day', 'day', 'month', 'month']);
  });
});

describe('geometry', () => {
  it('step path holds Versé flat then jumps at the next sample', () => {
    expect(buildStepPath([pt('a', 100, 0), pt('b', 150, 0), pt('c', 150, 0)], x, y)).toBe('M 0.0 100.0 H 10.0 V 150.0 H 20.0 V 150.0');
  });

  it('value segments dash when either end is estimated and merge equal runs', () => {
    const segs = buildValueSegments([pt('a', 0, 1), pt('b', 0, 2), pt('c', 0, 3, true), pt('d', 0, 4, true), pt('e', 0, 5)], x, y);
    expect(segs.map((s) => s.dashed)).toEqual([false, true]);
    expect(segs[0]!.d).toBe('M 0.0 1.0 L 10.0 2.0');
    expect(segs[1]!.d).toBe('M 10.0 2.0 L 20.0 3.0 L 30.0 4.0 L 40.0 5.0');
  });

  it('colours the area by the sign of the gain', () => {
    const up = buildGainAreas([pt('a', 100, 110), pt('b', 100, 120)], x, y);
    expect(up.positive).not.toBe('');
    expect(up.negative).toBe('');
    const down = buildGainAreas([pt('a', 100, 90), pt('b', 100, 80)], x, y);
    expect(down.positive).toBe('');
    expect(down.negative).not.toBe('');
  });

  it('splits the area at a zero crossing into one green and one red triangle', () => {
    // gain goes -10 -> +10 over the interval: crossing at the midpoint.
    const a = buildGainAreas([pt('a', 100, 90), pt('b', 100, 110)], x, y);
    expect(a.negative).toBe('M 0.0 100.0 L 5.0 100.0 L 0.0 90.0 Z');
    expect(a.positive).toBe('M 5.0 100.0 L 10.0 100.0 L 10.0 110.0 Z');
  });

  it('uses the step level of the interval start when Versé jumps', () => {
    // Versé jumps 100 -> 200 at b; the first interval is measured against 100.
    const a = buildGainAreas([pt('a', 100, 110), pt('b', 200, 210), pt('c', 200, 215)], x, y);
    expect(a.positive.startsWith('M 0.0 100.0 L 10.0 100.0 L 10.0 210.0 L 0.0 110.0 Z')).toBe(true);
  });

  it('range covers both lines with headroom and does not force zero', () => {
    const r = computePlacementRange([pt('a', 1000, 1100), pt('b', 1200, 1300)]);
    expect(r.minY).toBeLessThan(1000);
    expect(r.minY).toBeGreaterThan(800);
    expect(r.maxY).toBeGreaterThan(1300);
    expect(r.range).toBeCloseTo(r.maxY - r.minY);
    expect(computePlacementRange([pt('a', 5, 5)]).range).toBeGreaterThan(0);
  });
});
