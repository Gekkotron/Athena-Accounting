import { describe, it, expect } from 'vitest';
import {
  isoDate,
  mergeHistoricalAndProjection,
  computeYRange,
  computeActiveWindow,
  buildSegments,
  buildAreaPath,
  buildAxisTicks,
  MIN_ZOOM_WIDTH_VB,
  type Sample,
} from '../lib';

describe('isoDate', () => {
  it('formats a millisecond timestamp as YYYY-MM-DD in local time', () => {
    // Use noon UTC to sidestep local-vs-UTC boundary flip in most timezones.
    const ms = Date.UTC(2026, 6, 15, 12, 0, 0);
    expect(isoDate(ms)).toMatch(/^2026-07-1[45]$/);
  });

  it('pads single-digit month and day with leading zero', () => {
    const ms = Date.UTC(2026, 0, 3, 12, 0, 0);
    expect(isoDate(ms)).toMatch(/^2026-01-0[23]$/);
  });
});

describe('mergeHistoricalAndProjection', () => {
  const raw: Sample[] = [
    { date: '2026-07-01', value: 1000 },
    { date: '2026-07-15', value: 1200 },
  ];

  it('returns historical as-is with projectionStartIdx == length when no projection', () => {
    const r = mergeHistoricalAndProjection({ raw });
    expect(r.data).toEqual(raw);
    expect(r.projectionStartIdx).toBe(2);
  });

  it('shifts historical when alignEndTo differs from last value', () => {
    const r = mergeHistoricalAndProjection({ raw, alignEndTo: 1500 });
    expect(r.data[0]).toEqual({ date: '2026-07-01', value: 1300 });
    expect(r.data[1]).toEqual({ date: '2026-07-15', value: 1500 });
  });

  it('leaves values untouched when alignEndTo matches the last value (zero shift)', () => {
    const r = mergeHistoricalAndProjection({ raw, alignEndTo: 1200 });
    expect(r.data).toEqual(raw);
  });

  it('appends forward-dated projection samples, sorted', () => {
    const r = mergeHistoricalAndProjection({
      raw,
      projection: [
        { date: '2026-08-15', value: 1400 },
        { date: '2026-08-01', value: 1300 },
      ],
    });
    expect(r.projectionStartIdx).toBe(2);
    expect(r.data.slice(2).map((p) => p.date)).toEqual(['2026-08-01', '2026-08-15']);
  });

  it('filters out projection samples dated on-or-before the historical anchor', () => {
    const r = mergeHistoricalAndProjection({
      raw,
      projection: [
        { date: '2026-07-15', value: 999 },
        { date: '2026-07-10', value: 888 },
        { date: '2026-08-01', value: 1300 },
      ],
    });
    expect(r.data.slice(2)).toEqual([{ date: '2026-08-01', value: 1300 }]);
  });

  it('handles empty raw gracefully', () => {
    const r = mergeHistoricalAndProjection({ raw: [], projection: [{ date: '2026-08-01', value: 1 }] });
    expect(r.projectionStartIdx).toBe(0);
    // anchorDate defaults to '' so every projection date is > '' — all included.
    expect(r.data).toEqual([{ date: '2026-08-01', value: 1 }]);
  });
});

describe('computeYRange', () => {
  it('always includes zero in the range', () => {
    expect(computeYRange([{ date: 'a', value: 5 }, { date: 'b', value: 10 }])).toEqual({
      minY: 0,
      maxY: 10,
      range: 10,
    });
    expect(computeYRange([{ date: 'a', value: -5 }, { date: 'b', value: -1 }])).toEqual({
      minY: -5,
      maxY: 0,
      range: 5,
    });
  });

  it('falls back to range=1 when all values are zero (avoids divide-by-zero downstream)', () => {
    expect(computeYRange([{ date: 'a', value: 0 }, { date: 'b', value: 0 }])).toEqual({
      minY: 0,
      maxY: 0,
      range: 1,
    });
  });
});

describe('computeActiveWindow', () => {
  const data: Sample[] = [
    { date: '2026-07-01', value: 0 },
    { date: '2026-07-15', value: 0 },
  ];

  it('spans data extent when no zoom is set', () => {
    const w = computeActiveWindow(data, null);
    expect(w.activeFirstMs).toBe(Date.parse('2026-07-01'));
    expect(w.activeLastMs).toBe(Date.parse('2026-07-15'));
    expect(w.xSpan).toBeGreaterThan(0);
  });

  it('narrows to the zoom window when provided', () => {
    const zoom = { startMs: Date.parse('2026-07-05'), endMs: Date.parse('2026-07-10') };
    const w = computeActiveWindow(data, zoom);
    expect(w.activeFirstMs).toBe(zoom.startMs);
    expect(w.activeLastMs).toBe(zoom.endMs);
  });

  it('clamps xSpan to at least 1ms to avoid divide-by-zero', () => {
    const same = Date.parse('2026-07-01');
    const w = computeActiveWindow(data, { startMs: same, endMs: same });
    expect(w.xSpan).toBe(1);
  });
});

describe('buildSegments', () => {
  const xScaleAt = (i: number) => i * 10;
  const yScale = (v: number) => 100 - v;

  it('returns empty when data has fewer than 2 samples', () => {
    expect(buildSegments({ data: [], projectionStartIdx: 0, gapThresholdDays: 6, xScaleAt, yScale })).toEqual([]);
    expect(
      buildSegments({
        data: [{ date: '2026-07-01', value: 10 }],
        projectionStartIdx: 1,
        gapThresholdDays: 6,
        xScaleAt,
        yScale,
      }),
    ).toEqual([]);
  });

  it('emits a single solid segment when all gaps are within threshold and no projection', () => {
    const data: Sample[] = [
      { date: '2026-07-01', value: 10 },
      { date: '2026-07-02', value: 20 },
      { date: '2026-07-03', value: 30 },
    ];
    const s = buildSegments({ data, projectionStartIdx: data.length, gapThresholdDays: 6, xScaleAt, yScale });
    expect(s).toHaveLength(1);
    expect(s[0]!.dashed).toBe(false);
  });

  it('splits into solid + dashed at the projection boundary', () => {
    const data: Sample[] = [
      { date: '2026-07-01', value: 10 },
      { date: '2026-07-02', value: 20 },
      { date: '2026-07-03', value: 30 },
      { date: '2026-07-04', value: 40 },
    ];
    const s = buildSegments({ data, projectionStartIdx: 2, gapThresholdDays: 6, xScaleAt, yScale });
    expect(s.map((seg) => seg.dashed)).toEqual([false, true]);
  });

  it('marks a segment dashed when its gap exceeds gapThresholdDays', () => {
    const data: Sample[] = [
      { date: '2026-07-01', value: 10 },
      { date: '2026-07-02', value: 20 },
      { date: '2026-07-20', value: 30 },
      { date: '2026-07-21', value: 40 },
    ];
    const s = buildSegments({ data, projectionStartIdx: data.length, gapThresholdDays: 6, xScaleAt, yScale });
    expect(s.map((seg) => seg.dashed)).toEqual([false, true, false]);
  });
});

describe('buildAreaPath', () => {
  const xScaleAt = (i: number) => i * 10;
  const yScale = (v: number) => 100 - v;
  const pad = { top: 20, right: 20, bottom: 20, left: 20 };
  const innerH = 200;

  it('builds a closed polygon anchored to the plot bottom for the historical run only', () => {
    const data: Sample[] = [
      { date: '2026-07-01', value: 10 },
      { date: '2026-07-02', value: 20 },
      { date: '2026-07-03', value: 30 },
    ];
    const r = buildAreaPath({ data, projectionStartIdx: 3, xScaleAt, yScale, pad, innerH });
    expect(r.historicalPath.startsWith('M 0.0 90.0')).toBe(true);
    expect(r.areaPath.endsWith('Z')).toBe(true);
  });

  it('returns empty areaPath when there is no historical portion', () => {
    const data: Sample[] = [
      { date: '2026-07-04', value: 40 },
      { date: '2026-07-05', value: 50 },
    ];
    const r = buildAreaPath({ data, projectionStartIdx: 0, xScaleAt, yScale, pad, innerH });
    expect(r.areaPath).toBe('');
    expect(r.historicalPath).toBe('');
  });
});

describe('buildAxisTicks', () => {
  it('emits yTicks+1 evenly-spaced Y values and up to 6 X tick dates spanning the active window', () => {
    const activeFirstMs = Date.parse('2026-07-01');
    const xSpan = Date.parse('2026-07-15') - activeFirstMs;
    const r = buildAxisTicks({ minY: 0, range: 100, activeFirstMs, xSpan, dataLength: 20 });
    expect(r.tickValues).toEqual([0, 25, 50, 75, 100]);
    expect(r.xTicks).toHaveLength(6);
    expect(r.xTicks[0]).toMatch(/^2026-06-3\d|2026-07-01$/);
    expect(r.xTicks[5]).toMatch(/^2026-07-1[45]$/);
  });

  it('caps x ticks at 2 when data has only 2 samples', () => {
    const activeFirstMs = Date.parse('2026-07-01');
    const xSpan = Date.parse('2026-07-15') - activeFirstMs;
    const r = buildAxisTicks({ minY: 0, range: 100, activeFirstMs, xSpan, dataLength: 2 });
    expect(r.xTicks).toHaveLength(2);
  });
});

describe('MIN_ZOOM_WIDTH_VB', () => {
  it('is a small positive threshold in viewBox units', () => {
    expect(MIN_ZOOM_WIDTH_VB).toBeGreaterThan(0);
    expect(MIN_ZOOM_WIDTH_VB).toBeLessThan(50);
  });
});
