import { describe, it, expect, beforeEach } from 'vitest';
import { api, registerSeedProvider, getState } from '../index';
import { __resetForTest } from '../store';
import { buildSeedState } from '../seed';
import type { RecurringSeries } from '../../types';

beforeEach(() => {
  __resetForTest();
  registerSeedProvider(buildSeedState);
});

// The seed builds ~12 recurring series (see seed-transactions.ts:213).
// These tests exercise the demo endpoints only — the real backend has its
// own DB-integrated coverage.

interface RecurringResp { recurring: RecurringSeries[] }

describe('GET /api/recurring — demo read handler', () => {
  it('with no `upcoming` param → all series, sorted by monthly-equivalent |amount| desc', async () => {
    const r = await api<RecurringResp>('/api/recurring');
    expect(r.recurring.length).toBeGreaterThan(0);
    // Ordering invariant: |avg * 30/cadence| non-increasing.
    for (let i = 1; i < r.recurring.length; i++) {
      const prev = Math.abs(Number(r.recurring[i - 1]!.avgAmount) * (30 / r.recurring[i - 1]!.cadenceDays));
      const curr = Math.abs(Number(r.recurring[i]!.avgAmount) * (30 / r.recurring[i]!.cadenceDays));
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it('recomputes primaryAccountId from current transactions', async () => {
    const r = await api<RecurringResp>('/api/recurring');
    // At least one series should have a resolved primary account — the
    // seed transactions land on specific accounts, so majority-vote wins.
    expect(r.recurring.some((row) => row.primaryAccountId !== null)).toBe(true);
  });

  it('upcoming=30 → returns series with nextDueAt within horizon, sorted asc by nextDueAt', async () => {
    const r = await api<RecurringResp>('/api/recurring', { query: { upcoming: 30 } });
    for (let i = 1; i < r.recurring.length; i++) {
      expect(r.recurring[i - 1]!.nextDueAt <= r.recurring[i]!.nextDueAt).toBe(true);
    }
  });

  it('upcoming clamps horizons above 180 down to 180', async () => {
    const large = await api<RecurringResp>('/api/recurring', { query: { upcoming: 999 } });
    const at180 = await api<RecurringResp>('/api/recurring', { query: { upcoming: 180 } });
    expect(large.recurring.length).toBe(at180.recurring.length);
  });

  it('upcoming=0 or negative or NaN → { recurring: [] }', async () => {
    const zero = await api<RecurringResp>('/api/recurring', { query: { upcoming: 0 } });
    const neg = await api<RecurringResp>('/api/recurring', { query: { upcoming: -5 } });
    const nan = await api<RecurringResp>('/api/recurring', { query: { upcoming: 'not-a-number' } });
    expect(zero.recurring).toEqual([]);
    expect(neg.recurring).toEqual([]);
    expect(nan.recurring).toEqual([]);
  });
});

describe('PUT /api/recurring/:id — demo write handler', () => {
  it('patches status only', async () => {
    const before = getState().recurring![0]!;
    const r = await api<{ recurring: RecurringSeries }>(`/api/recurring/${before.id}`, {
      method: 'PUT',
      json: { status: 'dismissed' },
    });
    expect(r.recurring.status).toBe('dismissed');
    expect(r.recurring.essentialness).toBe(before.essentialness);
    // updatedAt moved forward (or stayed >=, since clocks can tie in ms).
    expect(r.recurring.updatedAt >= before.updatedAt).toBe(true);
  });

  it('patches essentialness only (including explicit null)', async () => {
    const target = getState().recurring![0]!;
    const set = await api<{ recurring: RecurringSeries }>(`/api/recurring/${target.id}`, {
      method: 'PUT',
      json: { essentialness: 'essential' },
    });
    expect(set.recurring.essentialness).toBe('essential');
    const cleared = await api<{ recurring: RecurringSeries }>(`/api/recurring/${target.id}`, {
      method: 'PUT',
      json: { essentialness: null },
    });
    expect(cleared.recurring.essentialness).toBeNull();
  });

  it('unknown id → { error: "not found" }, state unchanged', async () => {
    const before = getState().recurring!.length;
    const r = await api<{ error: string }>('/api/recurring/999999', {
      method: 'PUT',
      json: { status: 'confirmed' },
    });
    expect(r.error).toBe('not found');
    expect(getState().recurring!.length).toBe(before);
  });
});

describe('POST /api/recurring/regenerate — demo write handler', () => {
  it('returns detected + refreshed counts derived from current state', async () => {
    const rows = getState().recurring ?? [];
    const detected = rows.filter((r) => r.status === 'detected').length;
    const refreshed = rows.filter((r) => r.status !== 'detected').length;
    const r = await api<{ ok: boolean; detected: number; refreshed: number }>(
      '/api/recurring/regenerate', { method: 'POST' },
    );
    expect(r).toEqual({ ok: true, detected, refreshed });
  });
});
