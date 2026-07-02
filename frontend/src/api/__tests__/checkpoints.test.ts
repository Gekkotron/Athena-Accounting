import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listCheckpoints,
  createCheckpoint,
  updateCheckpoint,
  deleteCheckpoint,
} from '../checkpoints';

const originalFetch = globalThis.fetch;

function mockFetch(handler: (input: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    handler(typeof input === 'string' ? input : input.toString(), init),
  );
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return fn;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => { globalThis.fetch = originalFetch; });
beforeEach(() => {});

describe('checkpoints API', () => {
  it('listCheckpoints GETs the per-account endpoint', async () => {
    const spy = mockFetch(() => json({ checkpoints: [] }));
    const res = await listCheckpoints(7);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/accounts/7/balance-checkpoints');
    expect((init as RequestInit).method).toBeUndefined(); // GET default
    expect(res.checkpoints).toEqual([]);
  });

  it('createCheckpoint POSTs the body as JSON', async () => {
    const spy = mockFetch(() => json({ checkpoint: { id: 1 } }));
    await createCheckpoint(7, { checkpointDate: '2026-07-01', expectedAmount: '1234.56', note: 'juillet' });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/accounts/7/balance-checkpoints');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ checkpointDate: '2026-07-01', expectedAmount: '1234.56', note: 'juillet' });
  });

  it('updateCheckpoint PUTs the patch to the row endpoint', async () => {
    const spy = mockFetch(() => json({ checkpoint: { id: 3 } }));
    await updateCheckpoint(7, 3, { expectedAmount: '99.99' });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/accounts/7/balance-checkpoints/3');
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ expectedAmount: '99.99' });
  });

  it('deleteCheckpoint DELETEs the row endpoint', async () => {
    const spy = mockFetch(() => json({}));
    await deleteCheckpoint(7, 3);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/accounts/7/balance-checkpoints/3');
    expect((init as RequestInit).method).toBe('DELETE');
  });
});
