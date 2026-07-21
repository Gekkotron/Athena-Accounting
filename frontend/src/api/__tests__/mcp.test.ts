import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getMcpSettings,
  setMcpEnabled,
  generateMcpToken,
  revokeMcpToken,
} from '../mcp';

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

describe('mcp API', () => {
  it('getMcpSettings GETs /api/settings/mcp and returns the payload', async () => {
    const spy = mockFetch(() => json({ enabled: true, hasToken: false }));
    const res = await getMcpSettings();
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/settings/mcp');
    expect((init as RequestInit).method).toBeUndefined();
    expect(res).toEqual({ enabled: true, hasToken: false });
  });

  it('setMcpEnabled PUTs the enabled flag as JSON to /api/settings/mcp', async () => {
    const spy = mockFetch(() => json({ enabled: false, hasToken: true }));
    const res = await setMcpEnabled(false);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/settings/mcp');
    expect((init as RequestInit).method).toBe('PUT');
    expect(new Headers((init as RequestInit).headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ enabled: false });
    expect(res).toEqual({ enabled: false, hasToken: true });
  });

  it('generateMcpToken POSTs to /api/settings/mcp/token and returns the token', async () => {
    const spy = mockFetch(() => json({ token: 'sk_test_deadbeef' }));
    const res = await generateMcpToken();
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/settings/mcp/token');
    expect((init as RequestInit).method).toBe('POST');
    expect(res).toEqual({ token: 'sk_test_deadbeef' });
  });

  it('revokeMcpToken DELETEs /api/settings/mcp/token', async () => {
    const spy = mockFetch(() => json({ ok: true }));
    const res = await revokeMcpToken();
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/settings/mcp/token');
    expect((init as RequestInit).method).toBe('DELETE');
    expect(res).toEqual({ ok: true });
  });
});
