// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;

describe.skipIf(!RUN)('/api/tips', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'tips', password: 'tips-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'tips', password: 'tips-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { userSettings } = await import('../src/db/schema.js');
    await db.delete(userSettings);
  });

  it('GET /dismissed without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tips/dismissed' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /dismissed for a fresh user returns {}', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/tips/dismissed', headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ dismissed: {} });
  });

  it('POST /dismiss known id → 204, subsequent GET reflects it', async () => {
    const post = await app.inject({
      method: 'POST', url: '/api/tips/dismiss', headers: { cookie },
      payload: { id: 'tour:dashboard' },
    });
    expect(post.statusCode).toBe(204);

    const get = await app.inject({
      method: 'GET', url: '/api/tips/dismissed', headers: { cookie },
    });
    const dismissed = get.json().dismissed as Record<string, string>;
    expect(Object.keys(dismissed)).toEqual(['tour:dashboard']);
    expect(new Date(dismissed['tour:dashboard']!).getTime())
      .toBeGreaterThan(Date.now() - 60_000);
  });

  it('POST /dismiss unknown id → 400, column unchanged', async () => {
    const post = await app.inject({
      method: 'POST', url: '/api/tips/dismiss', headers: { cookie },
      payload: { id: 'not_a_real_tip' },
    });
    expect(post.statusCode).toBe(400);
    expect(post.json()).toMatchObject({ error: 'unknown_tip_id' });

    const get = await app.inject({
      method: 'GET', url: '/api/tips/dismissed', headers: { cookie },
    });
    expect(get.json()).toEqual({ dismissed: {} });
  });

  it('POST /undismiss removes the key', async () => {
    await app.inject({
      method: 'POST', url: '/api/tips/dismiss', headers: { cookie },
      payload: { id: 'tour:dashboard' },
    });
    const un = await app.inject({
      method: 'POST', url: '/api/tips/undismiss', headers: { cookie },
      payload: { id: 'tour:dashboard' },
    });
    expect(un.statusCode).toBe(204);

    const get = await app.inject({
      method: 'GET', url: '/api/tips/dismissed', headers: { cookie },
    });
    expect(get.json()).toEqual({ dismissed: {} });
  });

  it('POST /undismiss unknown id → 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/tips/undismiss', headers: { cookie },
      payload: { id: 'not_a_real_tip' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /reset clears the blob', async () => {
    await app.inject({
      method: 'POST', url: '/api/tips/dismiss', headers: { cookie },
      payload: { id: 'tour:dashboard' },
    });
    await app.inject({
      method: 'POST', url: '/api/tips/dismiss', headers: { cookie },
      payload: { id: 'tour:budgets' },
    });
    const reset = await app.inject({
      method: 'POST', url: '/api/tips/reset', headers: { cookie },
    });
    expect(reset.statusCode).toBe(204);

    const get = await app.inject({
      method: 'GET', url: '/api/tips/dismissed', headers: { cookie },
    });
    expect(get.json()).toEqual({ dismissed: {} });
  });

  it('all endpoints require auth', async () => {
    for (const url of ['/api/tips/dismissed']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode).toBe(401);
    }
    for (const [method, url] of [
      ['POST', '/api/tips/dismiss'],
      ['POST', '/api/tips/undismiss'],
      ['POST', '/api/tips/reset'],
    ] as const) {
      const r = await app.inject({ method, url, payload: { id: 'tour:dashboard' } });
      expect(r.statusCode).toBe(401);
    }
  });
});
