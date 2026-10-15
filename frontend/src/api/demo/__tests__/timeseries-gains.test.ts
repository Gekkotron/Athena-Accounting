import { describe, it, expect, beforeEach } from 'vitest';
import { api, registerSeedProvider } from '../index';
import { __resetForTest } from '../store';
import { buildSeedState, SEED_META } from '../seed';
import type { BalancePoint } from '../../types';

beforeEach(() => {
  __resetForTest();
  registerSeedProvider(buildSeedState);
});

const get = (query: Record<string, unknown>) =>
  api<{ points: BalancePoint[]; consolidated: { points: Array<{ bucket: string }> } | null }>('/api/reports/timeseries', { query });

describe('demo GET /api/reports/timeseries withGains=1', () => {
  const av = SEED_META.accountIds.AssuranceVie;
  const rows = (r: { points: BalancePoint[] }) => r.points.filter((p) => p.account_id === av);

  it('replaces the investment rows with dense Valeur rows hitting each valuation', async () => {
    const plain = await get({ granularity: 'day', display: 'none' });
    const gains = await get({ granularity: 'day', display: 'none', withGains: 1 });
    const dense = rows(gains);
    expect(dense.length).toBeGreaterThan(rows(plain).length);
    const at = (d: string) => dense.find((p) => p.bucket === d)!;
    expect(at('2026-03-31').cumulative).toBe('4120.50');
    expect(at('2026-05-29').cumulative).toBe('4290.00');
    expect(at('2026-07-10').cumulative).toBe('4388.75');
    // Consecutive days: delta is the change in Valeur.
    const i = dense.findIndex((p) => p.bucket === '2026-05-29');
    expect(Number(dense[i]!.delta)).toBeCloseTo(Number(dense[i]!.cumulative) - Number(dense[i - 1]!.cumulative), 2);
  });

  it('leaves non-investment accounts untouched and ignores the flag when absent', async () => {
    const plain = await get({ granularity: 'day', display: 'none' });
    const gains = await get({ granularity: 'day', display: 'none', withGains: 1 });
    const others = (r: { points: BalancePoint[] }) => r.points.filter((p) => p.account_id !== av);
    expect(others(gains)).toEqual(others(plain));
    expect(rows(await get({ granularity: 'day', display: 'none' }))).toEqual(rows(plain));
  });

  it('computes the consolidated block from the final rows', async () => {
    const plain = await get({ granularity: 'day', display: 'EUR' });
    const gains = await get({ granularity: 'day', display: 'EUR', withGains: 1 });
    expect(gains.consolidated!.points.length).toBeGreaterThanOrEqual(plain.consolidated!.points.length);
    expect(JSON.stringify(gains.consolidated)).not.toBe(JSON.stringify(plain.consolidated));
  });
});
