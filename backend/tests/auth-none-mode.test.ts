// Parallel suite for AUTH_MODE=none (Tauri desktop path).
//
// Boots the same Fastify app the LAN/Docker path uses, but with the session
// middleware and requireAuth turned into no-ops. Every request should
// authenticate as the seeded local user without a login round-trip.
//
// Runs only when the caller sets both AUTH_MODE=none and RUN_DB_TESTS=1 —
// the DB gate stays the same as the rest of the route suite; the AUTH_MODE
// gate keeps the file skipped from a plain `npm test` invocation, so the
// existing session-based suites aren't disturbed.
import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = process.env.AUTH_MODE === 'none' && !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;

describe.skipIf(!RUN)('AUTH_MODE=none — auth is a no-op', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { ensureLocalUser } = await import('../src/domain/auth/localUser.js');
    await ensureLocalUser();
    app = await buildApp();
  });

  it('reaches /api/accounts without logging in', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/accounts' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().accounts)).toBe(true);
  });

  it('creates an account without a cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: { name: 'NoAuthAccount', type: 'checking', openingDate: '2025-01-01' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().account.name).toBe('NoAuthAccount');
  });

  it('/api/auth/me returns the seeded local user without a login', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('local');
  });
});
