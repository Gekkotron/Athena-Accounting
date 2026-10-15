import { describe, it, expect, beforeEach } from 'vitest';
import { api, registerSeedProvider } from '../index';
import { __resetForTest } from '../store';
import { buildSeedState, SEED_META } from '../seed';
import type { InvestmentsTimeseries } from '../../../../../shared/api-contracts';

beforeEach(() => {
  __resetForTest();
  registerSeedProvider(buildSeedState);
});

const get = (query: Record<string, unknown>) =>
  api<InvestmentsTimeseries>('/api/reports/investments-timeseries', { query });

describe('demo GET /api/reports/investments-timeseries', () => {
  const av = SEED_META.accountIds.AssuranceVie;

  it('flags only interpolated / carried investment days as estimated and hits the valuations exactly', async () => {
    const r = await get({ accountId: av, granularity: 'day', display: 'none' });
    expect(r.consolidated).toBeNull();
    const at = (d: string) => r.points.find((p) => p.bucket === d)!;
    // Before the first valuation the value is the book balance.
    expect(at('2026-03-01').estimated).toBe(false);
    // Valuation days are exact and not estimated.
    expect(at('2026-03-31')).toMatchObject({ value: '4120.50', estimated: false });
    expect(at('2026-05-29')).toMatchObject({ value: '4290.00', estimated: false });
    // Between two valuations the gain is interpolated.
    const mid = at('2026-05-01');
    expect(mid.estimated).toBe(true);
    expect(Number(mid.gain)).toBeGreaterThan(Number(at('2026-03-31').gain));
    expect(Number(mid.gain)).toBeLessThan(Number(at('2026-05-29').gain));
    // After the last valuation the gain is carried forward.
    const last = r.points[r.points.length - 1]!;
    expect(last.bucket).toBe('2026-07-18');
    expect(last).toMatchObject({ contributed: '4000.00', gain: '388.75', value: '4388.75', estimated: true });
  });

  it('savings: Valeur is book, gain is the interest, never estimated', async () => {
    const r = await get({ accountId: SEED_META.accountIds.Livret, display: 'none' });
    const last = r.points[r.points.length - 1]!;
    expect(last).toMatchObject({ contributed: '8000.00', gain: '62.40', estimated: false });
  });

  it('month granularity buckets on the first of the month with end-of-month values; fromDate clips', async () => {
    const r = await get({ accountId: av, granularity: 'month', fromDate: '2026-05-01', display: 'none' });
    expect(r.points.map((p) => p.bucket)).toEqual(['2026-05-01', '2026-06-01', '2026-07-01']);
    // May contains the 2026-05-29 valuation, so the bucket is not estimated.
    expect(r.points[0]!.estimated).toBe(false);
    expect(r.points[1]!.estimated).toBe(true);
  });

  it('consolidated block mirrors the points in the display currency', async () => {
    const r = await get({ display: 'EUR', granularity: 'month' });
    expect(r.consolidated!.display).toBe('EUR');
    expect(r.consolidated!.points.length).toBe(new Set(r.points.map((p) => p.bucket)).size);
  });

  it('rejects an account that is neither investment nor savings', async () => {
    await expect(get({ accountId: SEED_META.accountIds.Courant })).rejects.toMatchObject({ status: 400 });
  });
});
