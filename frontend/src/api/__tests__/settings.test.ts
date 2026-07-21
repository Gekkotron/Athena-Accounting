import { describe, it, expect, afterEach, vi } from 'vitest';
import { getSettings, patchSettings } from '../settings';

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

describe('settings API', () => {
  it('getSettings GETs /api/settings and returns the { settings } envelope', async () => {
    const settings = { locale: 'fr', theme: 'dark' } as unknown;
    const spy = mockFetch(() => json({ settings }));
    const res = await getSettings();
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/settings');
    expect((init as RequestInit).method).toBeUndefined();
    expect(res).toEqual({ settings });
  });

  it('patchSettings PATCHes only the fields it was given', async () => {
    const spy = mockFetch(() => json({ settings: { locale: 'en', theme: 'light' } }));
    await patchSettings({ locale: 'en' } as unknown as Parameters<typeof patchSettings>[0]);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/settings');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(new Headers((init as RequestInit).headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ locale: 'en' });
  });

  it('patchSettings returns the server-echoed settings envelope', async () => {
    const returned = { locale: 'en', theme: 'light' };
    mockFetch(() => json({ settings: returned }));
    const res = await patchSettings({ locale: 'en' } as unknown as Parameters<typeof patchSettings>[0]);
    expect(res).toEqual({ settings: returned });
  });
});
