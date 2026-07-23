import { describe, it, expect, beforeEach } from 'vitest';
import { api, registerSeedProvider } from '../index';
import { __resetForTest } from '../store';
import { buildSeedState } from '../seed';
import { ApiError } from '../../apiError';
import { errorMessage, isDemoStubError } from '../../errorMessage';

beforeEach(() => {
  __resetForTest();
  registerSeedProvider(buildSeedState);
});

const noopT = ((k: string) => k) as unknown as Parameters<typeof errorMessage>[1];

describe('demo stubs + errorMessage', () => {
  it('POST /api/imports rejects with demoStub', async () => {
    let caught: unknown = null;
    try {
      await api('/api/imports', { method: 'POST', json: {} });
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(501);
    expect(isDemoStubError(caught)).toBe(true);
    // Was a hard-coded French literal; now goes through i18n. The passthrough
    // `noopT` returns the key, so this test locks in the routing rather than
    // the copy — the actual French/English strings live in the locale JSONs.
    expect(errorMessage(caught, noopT)).toBe('errors.demoUnavailable');
  });

  it('GET /api/pdf-templates is stubbed', async () => {
    let caught: unknown = null;
    try { await api('/api/pdf-templates'); } catch (e) { caught = e; }
    expect(isDemoStubError(caught)).toBe(true);
  });

  it('GET /api/settings/mcp returns disabled placeholder (not a stub)', async () => {
    const r = await api<{ enabled: boolean; hasToken: boolean }>('/api/settings/mcp');
    expect(r.enabled).toBe(false);
    expect(r.hasToken).toBe(false);
  });

  it('POST /api/settings/mcp/token is stubbed', async () => {
    let caught: unknown = null;
    try { await api('/api/settings/mcp/token', { method: 'POST' }); } catch (e) { caught = e; }
    expect(isDemoStubError(caught)).toBe(true);
  });
});
