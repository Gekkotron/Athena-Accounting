import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
const RUN = !!process.env.RUN_DB_TESTS;

describe.skipIf(!RUN)('/api/settings/mcp', () => {
  let app: FastifyInstance;
  let cookie: string;
  beforeAll(async () => {
    const { buildApp } = await import('../helpers/build-app.js');
    app = await buildApp();
    await app.inject({ method: 'POST', url: '/api/onboarding/create', payload: { username: 'mcpu', password: 'mcpu-1234' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'mcpu', password: 'mcpu-1234' } });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  });
  afterEach(async () => {
    const { db } = await import('../../src/db/client.js');
    const { userSettings } = await import('../../src/db/schema.js');
    await db.delete(userSettings);
  });

  it('requires auth', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/settings/mcp' })).statusCode).toBe(401);
  });

  it('defaults to disabled + no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/mcp', headers: { cookie } });
    expect(res.json()).toEqual({ enabled: false, hasToken: false });
  });

  it('PUT toggles enabled', async () => {
    await app.inject({ method: 'PUT', url: '/api/settings/mcp', headers: { cookie }, payload: { enabled: true } });
    const res = await app.inject({ method: 'GET', url: '/api/settings/mcp', headers: { cookie } });
    expect(res.json().enabled).toBe(true);
  });

  it('POST token returns a token once and sets hasToken', async () => {
    const gen = await app.inject({ method: 'POST', url: '/api/settings/mcp/token', headers: { cookie } });
    expect(gen.statusCode).toBe(201);
    expect(typeof gen.json().token).toBe('string');
    expect(gen.json().token.length).toBeGreaterThan(20);
    const st = await app.inject({ method: 'GET', url: '/api/settings/mcp', headers: { cookie } });
    expect(st.json().hasToken).toBe(true);
    // The raw token/hash is never echoed by GET.
    expect(JSON.stringify(st.json())).not.toContain(gen.json().token);
  });

  it('regenerating changes the token; DELETE revokes', async () => {
    const a = (await app.inject({ method: 'POST', url: '/api/settings/mcp/token', headers: { cookie } })).json().token;
    const b = (await app.inject({ method: 'POST', url: '/api/settings/mcp/token', headers: { cookie } })).json().token;
    expect(a).not.toBe(b);
    await app.inject({ method: 'DELETE', url: '/api/settings/mcp/token', headers: { cookie } });
    expect((await app.inject({ method: 'GET', url: '/api/settings/mcp', headers: { cookie } })).json().hasToken).toBe(false);
  });

  it('general GET /api/settings exposes no mcp fields', async () => {
    await app.inject({ method: 'POST', url: '/api/settings/mcp/token', headers: { cookie } });
    const res = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(Object.keys(res.json().settings).some((k) => k.toLowerCase().includes('mcp'))).toBe(false);
  });
});
