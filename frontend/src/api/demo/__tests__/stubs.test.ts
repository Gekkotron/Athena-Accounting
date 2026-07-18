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
    expect(errorMessage(caught, noopT)).toBe(
      "Cette fonctionnalité n'est pas disponible dans la démo. Installez Athena pour l'utiliser.",
    );
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
