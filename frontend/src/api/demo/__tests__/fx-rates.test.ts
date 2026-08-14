import { describe, it, expect, beforeEach } from 'vitest';
import { api, registerSeedProvider } from '../index';
import { __resetForTest } from '../store';
import { buildSeedState } from '../seed';
import { ApiError } from '../../apiError';

interface FxRateWire { id: number; from: string; to: string; effectiveFrom: string; rate: string }
interface ListResp { rates: FxRateWire[] }
interface OneResp { rate: FxRateWire }

async function expectApiError(fn: () => Promise<unknown>): Promise<ApiError> {
  let caught: unknown = null;
  try { await fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(ApiError);
  return caught as ApiError;
}

beforeEach(() => {
  __resetForTest();
  registerSeedProvider(buildSeedState);
});

describe('demo /api/fx-rates', () => {
  it('GET returns an empty list before any rate is created', async () => {
    const r = await api<ListResp>('/api/fx-rates');
    expect(r.rates).toEqual([]);
  });

  it('POST creates a rate and returns 201-shaped body', async () => {
    const r = await api<OneResp>('/api/fx-rates', {
      method: 'POST',
      json: { from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9' },
    });
    expect(r.rate).toMatchObject({ from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9' });
    expect(typeof r.rate.id).toBe('number');
  });

  it('GET sorts by (from, to, effectiveFrom DESC)', async () => {
    await api('/api/fx-rates', { method: 'POST', json: { from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9' } });
    await api('/api/fx-rates', { method: 'POST', json: { from: 'USD', to: 'EUR', effectiveFrom: '2026-06-01', rate: '0.85' } });
    await api('/api/fx-rates', { method: 'POST', json: { from: 'GBP', to: 'EUR', effectiveFrom: '2026-01-01', rate: '1.15' } });
    const r = await api<ListResp>('/api/fx-rates');
    expect(r.rates.map((x) => `${x.from}-${x.to}-${x.effectiveFrom}`)).toEqual([
      'GBP-EUR-2026-01-01',
      'USD-EUR-2026-06-01',
      'USD-EUR-2026-01-01',
    ]);
  });

  it('POST rejects invalid input: bad currency code, from === to, bad date, non-positive rate', async () => {
    const base = { from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9' };
    let err = await expectApiError(() => api('/api/fx-rates', { method: 'POST', json: { ...base, from: 'us' } }));
    expect(err.status).toBe(400);
    err = await expectApiError(() => api('/api/fx-rates', { method: 'POST', json: { ...base, to: 'USD' } }));
    expect(err.status).toBe(400);
    err = await expectApiError(() => api('/api/fx-rates', { method: 'POST', json: { ...base, effectiveFrom: '2026/01/01' } }));
    expect(err.status).toBe(400);
    err = await expectApiError(() => api('/api/fx-rates', { method: 'POST', json: { ...base, rate: '0' } }));
    expect(err.status).toBe(400);
    err = await expectApiError(() => api('/api/fx-rates', { method: 'POST', json: { ...base, rate: '-1' } }));
    expect(err.status).toBe(400);
  });

  it('POST rejects a duplicate (from, to, effectiveFrom) with 409 DUPLICATE_RATE', async () => {
    const body = { from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9' };
    await api('/api/fx-rates', { method: 'POST', json: body });
    const err = await expectApiError(() => api('/api/fx-rates', { method: 'POST', json: { ...body, rate: '0.95' } }));
    expect(err.status).toBe(409);
    expect((err.data as { code: string }).code).toBe('DUPLICATE_RATE');
  });

  it('PATCH updates rate and/or effectiveFrom', async () => {
    const created = await api<OneResp>('/api/fx-rates', {
      method: 'POST',
      json: { from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9' },
    });
    const patched = await api<OneResp>(`/api/fx-rates/${created.rate.id}`, {
      method: 'PATCH',
      json: { rate: '0.92' },
    });
    expect(patched.rate.rate).toBe('0.92');
    expect(patched.rate.effectiveFrom).toBe('2026-01-01');
  });

  it('PATCH 404s for a missing id', async () => {
    const err = await expectApiError(() => api('/api/fx-rates/999999', { method: 'PATCH', json: { rate: '1' } }));
    expect(err.status).toBe(404);
  });

  it('PATCH rejects invalid input (no fields, bad rate)', async () => {
    const created = await api<OneResp>('/api/fx-rates', {
      method: 'POST',
      json: { from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9' },
    });
    let err = await expectApiError(() => api(`/api/fx-rates/${created.rate.id}`, { method: 'PATCH', json: {} }));
    expect(err.status).toBe(400);
    err = await expectApiError(() => api(`/api/fx-rates/${created.rate.id}`, { method: 'PATCH', json: { rate: '0' } }));
    expect(err.status).toBe(400);
  });

  it('PATCH rejects a resulting duplicate (from, to, effectiveFrom) with 409', async () => {
    await api('/api/fx-rates', { method: 'POST', json: { from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9' } });
    const second = await api<OneResp>('/api/fx-rates', {
      method: 'POST',
      json: { from: 'USD', to: 'EUR', effectiveFrom: '2026-06-01', rate: '0.85' },
    });
    const err = await expectApiError(() =>
      api(`/api/fx-rates/${second.rate.id}`, { method: 'PATCH', json: { effectiveFrom: '2026-01-01' } }),
    );
    expect(err.status).toBe(409);
    expect((err.data as { code: string }).code).toBe('DUPLICATE_RATE');
  });

  it('DELETE removes a rate', async () => {
    const created = await api<OneResp>('/api/fx-rates', {
      method: 'POST',
      json: { from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9' },
    });
    await api(`/api/fx-rates/${created.rate.id}`, { method: 'DELETE' });
    const r = await api<ListResp>('/api/fx-rates');
    expect(r.rates.find((x) => x.id === created.rate.id)).toBeUndefined();
  });
});
