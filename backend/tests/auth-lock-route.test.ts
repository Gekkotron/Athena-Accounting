// requires Postgres/pglite — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS && process.env.AUTH_MODE !== 'none';

let app: FastifyInstance;
let cookie: string;

describe.skipIf(!RUN)('lock routes — session mode', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'lock-user', password: 'lock-pass-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'lock-user', password: 'lock-pass-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  });

  it('verify: correct password → 200 ok', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/verify',
      headers: { cookie }, payload: { password: 'lock-pass-1234' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('verify: wrong password → 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/verify',
      headers: { cookie }, payload: { password: 'nope-nope-nope' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid credentials');
  });

  it('verify: no session → 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/verify',
      payload: { password: 'lock-pass-1234' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('verify: malformed body → 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/verify',
      headers: { cookie }, payload: { password: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lock-status: session mode → lock always configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/lock-status', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: 'session', lockConfigured: true });
  });

  it('lock-status: no session → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/lock-status' });
    expect(res.statusCode).toBe(401);
  });

  it('lock-password routes do not exist in session mode', async () => {
    const put = await app.inject({
      method: 'PUT', url: '/api/auth/lock-password',
      headers: { cookie }, payload: { newPassword: 'whatever-123' },
    });
    expect(put.statusCode).toBe(404);
    const reset = await app.inject({
      method: 'POST', url: '/api/auth/lock-password/reset', headers: { cookie },
    });
    expect(reset.statusCode).toBe(404);
  });
});
