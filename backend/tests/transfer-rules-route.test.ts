// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let accountId: number;

describe.skipIf(!RUN)('/api/transfer-rules', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'tr-user', password: 'trrules-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'tr-user', password: 'trrules-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const acc = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'TR-A', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    accountId = acc.json().account.id;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { transferRules } = await import('../src/db/schema.js');
    await db.delete(transferRules);
  });

  it('creates an outgoing transfer rule tied to a counterpart account', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/transfer-rules',
      headers: { cookie },
      payload: { keyword: 'VIR LIVRET', direction: 'outgoing', counterpartAccountId: accountId },
    });
    expect(res.statusCode).toBe(201);
    const r = res.json().transferRule;
    expect(r.keyword).toBe('VIR LIVRET');
    expect(r.direction).toBe('outgoing');
    expect(r.counterpartAccountId).toBe(accountId);
    expect(r.enabled).toBe(true);
  });

  it('accepts a rule without a counterpart account (nullable)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/transfer-rules',
      headers: { cookie },
      payload: { keyword: 'VIR OPEN', direction: 'incoming' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().transferRule.counterpartAccountId).toBeNull();
  });

  it('lists rules', async () => {
    await app.inject({
      method: 'POST', url: '/api/transfer-rules',
      headers: { cookie },
      payload: { keyword: 'x', direction: 'outgoing' },
    });
    const res = await app.inject({
      method: 'GET', url: '/api/transfer-rules', headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().transferRules).toHaveLength(1);
  });

  it('rejects an invalid direction with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/transfer-rules',
      headers: { cookie },
      payload: { keyword: 'x', direction: 'sideways' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('updates a rule via PUT', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/transfer-rules',
      headers: { cookie },
      payload: { keyword: 'orig', direction: 'outgoing' },
    });
    const id = created.json().transferRule.id;
    const put = await app.inject({
      method: 'PUT', url: `/api/transfer-rules/${id}`,
      headers: { cookie },
      payload: { enabled: false, keyword: 'renamed' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().transferRule.enabled).toBe(false);
    expect(put.json().transferRule.keyword).toBe('renamed');
  });

  it('PUT rejects empty patch with 400', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/transfer-rules',
      headers: { cookie },
      payload: { keyword: 'k', direction: 'outgoing' },
    });
    const id = created.json().transferRule.id;
    const put = await app.inject({
      method: 'PUT', url: `/api/transfer-rules/${id}`,
      headers: { cookie }, payload: {},
    });
    expect(put.statusCode).toBe(400);
  });

  it('PUT returns 404 for missing id', async () => {
    const put = await app.inject({
      method: 'PUT', url: '/api/transfer-rules/999999',
      headers: { cookie }, payload: { enabled: false },
    });
    expect(put.statusCode).toBe(404);
  });

  it('deletes a rule', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/transfer-rules',
      headers: { cookie },
      payload: { keyword: 'gone', direction: 'outgoing' },
    });
    const id = created.json().transferRule.id;
    const del = await app.inject({
      method: 'DELETE', url: `/api/transfer-rules/${id}`, headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
  });

  it('DELETE returns 404 for missing id', async () => {
    const del = await app.inject({
      method: 'DELETE', url: '/api/transfer-rules/999999',
      headers: { cookie },
    });
    expect(del.statusCode).toBe(404);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/transfer-rules' });
    expect(res.statusCode).toBe(401);
  });
});
