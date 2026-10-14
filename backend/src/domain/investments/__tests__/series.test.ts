import { describe, it, expect } from 'vitest';
import {
  aggregateByCurrency,
  computeAccountSeries,
  consolidatePoints,
  type SeriesAccountInput,
} from '../series.js';

const base: SeriesAccountInput = {
  currency: 'EUR',
  type: 'investment',
  openingDate: '2026-01-01',
  openingCents: 100000,
  dailyDeltas: [],
  valuations: [],
};

const range = (over: Partial<Parameters<typeof computeAccountSeries>[1]> = {}) => ({
  fromDate: '2026-01-01',
  toDate: '2026-01-10',
  today: '2026-12-31',
  granularity: 'day' as const,
  ...over,
});

describe('computeAccountSeries', () => {
  it('uses book balance before the first valuation, not estimated', () => {
    const pts = computeAccountSeries(
      {
        ...base,
        dailyDeltas: [{ date: '2026-01-03', bookCents: 50000, contributedCents: 50000 }],
        valuations: [{ date: '2026-01-08', valueCents: 160000 }],
      },
      range(),
    );
    expect(pts[0]).toEqual({ bucket: '2026-01-01', contributedCents: 100000, valueCents: 100000, estimated: false });
    expect(pts[2]).toMatchObject({ bucket: '2026-01-03', valueCents: 150000, estimated: false });
    expect(pts[6]).toMatchObject({ bucket: '2026-01-07', estimated: false });
  });

  it('is exact on anchor days and carries the gain after the last anchor', () => {
    const pts = computeAccountSeries(
      { ...base, valuations: [{ date: '2026-01-04', valueCents: 110000 }] },
      range(),
    );
    const byDay = Object.fromEntries(pts.map((p) => [p.bucket, p]));
    expect(byDay['2026-01-04']).toMatchObject({ valueCents: 110000, estimated: false });
    expect(byDay['2026-01-10']).toMatchObject({ valueCents: 110000, contributedCents: 100000, estimated: true });
  });

  it('interpolates gain linearly by day between anchors', () => {
    const pts = computeAccountSeries(
      {
        ...base,
        valuations: [
          { date: '2026-01-02', valueCents: 100000 },
          { date: '2026-01-06', valueCents: 108000 },
        ],
      },
      range(),
    );
    const byDay = Object.fromEntries(pts.map((p) => [p.bucket, p]));
    expect(byDay['2026-01-03']!.valueCents).toBe(102000);
    expect(byDay['2026-01-04']!.valueCents).toBe(104000);
    expect(byDay['2026-01-05']!.valueCents).toBe(106000);
    expect(byDay['2026-01-03']!.estimated).toBe(true);
    expect(byDay['2026-01-06']).toMatchObject({ valueCents: 108000, estimated: false });
  });

  it('a mid-interval deposit raises the value immediately', () => {
    const pts = computeAccountSeries(
      {
        ...base,
        dailyDeltas: [{ date: '2026-01-04', bookCents: 20000, contributedCents: 20000 }],
        valuations: [
          { date: '2026-01-02', valueCents: 100000 },
          { date: '2026-01-06', valueCents: 128000 },
        ],
      },
      range(),
    );
    const byDay = Object.fromEntries(pts.map((p) => [p.bucket, p]));
    // anchors: gain 0 at d2 (versé 100000); gain 8000 at d6 (versé 120000)
    expect(byDay['2026-01-03']!.valueCents).toBe(102000);
    // d4: versé 120000 + gain 4000
    expect(byDay['2026-01-04']).toMatchObject({ contributedCents: 120000, valueCents: 124000 });
  });

  it('ignores valuations after today', () => {
    const pts = computeAccountSeries(
      { ...base, valuations: [{ date: '2026-01-05', valueCents: 200000 }] },
      range({ today: '2026-01-03' }),
    );
    expect(pts).toHaveLength(3);
    expect(pts.every((p) => p.valueCents === 100000 && !p.estimated)).toBe(true);
  });

  it('savings uses book balance; income lifts value but not versé', () => {
    const pts = computeAccountSeries(
      {
        ...base,
        type: 'savings',
        dailyDeltas: [
          { date: '2026-01-02', bookCents: 5000, contributedCents: 5000 },
          { date: '2026-01-03', bookCents: 300, contributedCents: 0 },
        ],
        valuations: [{ date: '2026-01-02', valueCents: 999999 }],
      },
      range(),
    );
    expect(pts[2]).toMatchObject({ contributedCents: 105000, valueCents: 105300, estimated: false });
    expect(pts.every((p) => !p.estimated)).toBe(true);
  });

  it('skips days before the account opens and respects fromDate', () => {
    const pts = computeAccountSeries(
      { ...base, openingDate: '2026-01-05' },
      range({ fromDate: '2026-01-01' }),
    );
    expect(pts[0]!.bucket).toBe('2026-01-05');
    const clipped = computeAccountSeries(base, range({ fromDate: '2026-01-08' }));
    expect(clipped.map((p) => p.bucket)).toEqual(['2026-01-08', '2026-01-09', '2026-01-10']);
  });

  it('ignores transactions dated before the opening date', () => {
    const pts = computeAccountSeries(
      { ...base, dailyDeltas: [{ date: '2025-12-01', bookCents: 9999, contributedCents: 9999 }] },
      range(),
    );
    expect(pts[0]!.valueCents).toBe(100000);
  });

  it('monthly bucket takes the last day and is exact when an anchor falls inside', () => {
    const acc: SeriesAccountInput = {
      ...base,
      valuations: [{ date: '2026-02-10', valueCents: 120000 }],
    };
    const pts = computeAccountSeries(acc, range({ toDate: '2026-04-15', granularity: 'month' }));
    expect(pts.map((p) => p.bucket)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
    expect(pts[0]).toMatchObject({ valueCents: 100000, estimated: false });
    // anchor inside February -> not estimated, even though Feb 28 is carried
    expect(pts[1]).toMatchObject({ valueCents: 120000, estimated: false });
    expect(pts[2]).toMatchObject({ valueCents: 120000, estimated: true });
    expect(pts[3]).toMatchObject({ valueCents: 120000, estimated: true });
  });

  it('caps the range at today', () => {
    const pts = computeAccountSeries(base, range({ toDate: '2026-12-31', today: '2026-01-02' }));
    expect(pts.map((p) => p.bucket)).toEqual(['2026-01-01', '2026-01-02']);
  });
});

describe('aggregateByCurrency / consolidatePoints', () => {
  const p = (bucket: string, c: number, v: number, estimated = false) => ({
    bucket,
    contributedCents: c,
    valueCents: v,
    estimated,
  });

  it('sums per currency and bucket, ORing estimated', () => {
    const out = aggregateByCurrency([
      { currency: 'EUR', points: [p('2026-01-01', 1000, 1100)] },
      { currency: 'EUR', points: [p('2026-01-01', 500, 450, true)] },
      { currency: 'USD', points: [p('2026-01-01', 200, 200)] },
    ]);
    expect(out).toEqual([
      { currency: 'EUR', bucket: '2026-01-01', contributed: '15.00', value: '15.50', gain: '0.50', estimated: true },
      { currency: 'USD', bucket: '2026-01-01', contributed: '2.00', value: '2.00', gain: '0.00', estimated: false },
    ]);
  });

  it('converts to the display currency and reports unmapped currencies', () => {
    const points = aggregateByCurrency([
      { currency: 'EUR', points: [p('2026-01-01', 10000, 11000)] },
      { currency: 'USD', points: [p('2026-01-01', 10000, 12000, true)] },
      { currency: 'GBP', points: [p('2026-01-01', 100, 100)] },
    ]);
    const out = consolidatePoints(points, 'EUR', [
      { fromCcy: 'USD', toCcy: 'EUR', effectiveFrom: '2025-01-01', rate: '0.5' },
    ]);
    expect(out).toEqual([
      {
        bucket: '2026-01-01',
        contributed: '150.00',
        value: '170.00',
        gain: '20.00',
        estimated: true,
        unmapped: ['GBP'],
      },
    ]);
  });
});
