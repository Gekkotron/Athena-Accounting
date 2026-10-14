import { describe, it, expect, afterEach, vi } from 'vitest';
import { listValuations, upsertValuation, deleteValuation } from '../valuations';

const originalFetch = globalThis.fetch;
function mockFetch(res: () => Response) {
  const fn = vi.fn(() => Promise.resolve(res()));
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return fn;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { globalThis.fetch = originalFetch; });

describe('valuations API', () => {
  it('lists via GET', async () => {
    const spy = mockFetch(() => json([{ id: 1, date: '2026-01-01', value: '10.00', source: 'manual' }]));
    const rows = await listValuations(4);
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('/api/accounts/4/valuations');
    expect(rows[0]!.value).toBe('10.00');
  });
  it('upserts via PUT with a JSON body', async () => {
    const spy = mockFetch(() => json({ id: 2, date: '2026-01-02', value: '11.00', source: 'manual' }));
    await upsertValuation(4, { date: '2026-01-02', value: '11.00' });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/accounts/4/valuations');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ date: '2026-01-02', value: '11.00' });
  });
  it('deletes via DELETE', async () => {
    const spy = mockFetch(() => new Response(null, { status: 204 }));
    await deleteValuation(4, 9);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/accounts/4/valuations/9');
    expect(init.method).toBe('DELETE');
  });
});
