// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let accountId: number;

describe.skipIf(!RUN)('/api/account-filename-patterns', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'ap-user', password: 'patterns-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'ap-user', password: 'patterns-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const acc = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'APAcc', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    accountId = acc.json().account.id;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { accountFilenamePatterns } = await import('../src/db/schema.js');
    await db.delete(accountFilenamePatterns);
  });

  it('creates a pattern with defaults', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/account-filename-patterns',
      headers: { cookie },
      payload: { pattern: 'compte_courant', accountId },
    });
    expect(res.statusCode).toBe(201);
    const p = res.json().pattern;
    expect(p.pattern).toBe('compte_courant');
    expect(p.priority).toBe(0);
  });

  it('rejects an unknown accountId with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/account-filename-patterns',
      headers: { cookie },
      payload: { pattern: 'x', accountId: 999999 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists patterns ordered by priority desc', async () => {
    await app.inject({
      method: 'POST', url: '/api/account-filename-patterns',
      headers: { cookie }, payload: { pattern: 'lo', accountId, priority: 1 },
    });
    await app.inject({
      method: 'POST', url: '/api/account-filename-patterns',
      headers: { cookie }, payload: { pattern: 'hi', accountId, priority: 99 },
    });
    const res = await app.inject({
      method: 'GET', url: '/api/account-filename-patterns', headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json().patterns;
    expect(list[0].pattern).toBe('hi');
    expect(list[1].pattern).toBe('lo');
  });

  it('updates a pattern via PUT', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/account-filename-patterns',
      headers: { cookie }, payload: { pattern: 'orig', accountId },
    });
    const id = created.json().pattern.id;
    const put = await app.inject({
      method: 'PUT', url: `/api/account-filename-patterns/${id}`,
      headers: { cookie }, payload: { priority: 42, pattern: 'renamed' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().pattern.priority).toBe(42);
    expect(put.json().pattern.pattern).toBe('renamed');
  });

  it('PUT rejects empty patch with 400', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/account-filename-patterns',
      headers: { cookie }, payload: { pattern: 'k', accountId },
    });
    const id = created.json().pattern.id;
    const put = await app.inject({
      method: 'PUT', url: `/api/account-filename-patterns/${id}`,
      headers: { cookie }, payload: {},
    });
    expect(put.statusCode).toBe(400);
  });

  it('PUT returns 404 for missing id', async () => {
    const put = await app.inject({
      method: 'PUT', url: '/api/account-filename-patterns/999999',
      headers: { cookie }, payload: { priority: 1 },
    });
    expect(put.statusCode).toBe(404);
  });

  it('deletes a pattern', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/account-filename-patterns',
      headers: { cookie }, payload: { pattern: 'gone', accountId },
    });
    const id = created.json().pattern.id;
    const del = await app.inject({
      method: 'DELETE', url: `/api/account-filename-patterns/${id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
  });

  it('DELETE returns 404 for missing id', async () => {
    const del = await app.inject({
      method: 'DELETE', url: '/api/account-filename-patterns/999999',
      headers: { cookie },
    });
    expect(del.statusCode).toBe(404);
  });

  it('rejects unauthenticated with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/account-filename-patterns' });
    expect(res.statusCode).toBe(401);
  });
});
