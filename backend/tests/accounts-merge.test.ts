// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;

async function setupUser(username: string, password: string): Promise<string> {
  await app.inject({
    method: 'POST', url: '/api/onboarding/create',
    payload: { username, password },
  });
  const login = await app.inject({
    method: 'POST', url: '/api/auth/login',
    payload: { username, password },
  });
  return login.cookies[0]!.name + '=' + login.cookies[0]!.value;
}

async function createAccount(
  cookie: string, name: string, currency: string, opening = '0',
): Promise<number> {
  const res = await app.inject({
    method: 'POST', url: '/api/accounts',
    headers: { cookie },
    payload: {
      name, type: 'checking', currency,
      openingBalance: opening, openingDate: '2025-01-01',
    },
  });
  return res.json().account.id;
}

describe.skipIf(!RUN)('POST /api/accounts/:sourceId/merge — validation', () => {
  let cookie: string;
  let srcEur: number;
  let tgtEur: number;
  let usd: number;

  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    cookie = await setupUser('merge-val-user', 'merge-val-1234');
    srcEur = await createAccount(cookie, 'MergeValSrcEUR', 'EUR');
    tgtEur = await createAccount(cookie, 'MergeValTgtEUR', 'EUR');
    usd = await createAccount(cookie, 'MergeValUSD', 'USD');
  });

  afterAll(async () => { await app.close(); });

  it('404 on unknown source', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/accounts/999999/merge',
      headers: { cookie }, payload: { targetId: tgtEur },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/source not found/);
  });

  it('404 on unknown target', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${srcEur}/merge`,
      headers: { cookie }, payload: { targetId: 999999 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/target not found/);
  });

  it('400 when source and target are the same', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${srcEur}/merge`,
      headers: { cookie }, payload: { targetId: srcEur },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/must differ/);
  });

  it('400 on currency mismatch (EUR -> USD)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${srcEur}/merge`,
      headers: { cookie }, payload: { targetId: usd },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/currency mismatch/);
    expect(res.json().sourceCurrency).toBe('EUR');
    expect(res.json().targetCurrency).toBe('USD');
  });

  it('404 when trying to merge another users account (non-enumeration)', async () => {
    const other = await setupUser('merge-val-other', 'merge-val-1234');
    const foreignSrc = await createAccount(other, 'ForeignSrc', 'EUR');
    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${foreignSrc}/merge`,
      headers: { cookie }, payload: { targetId: tgtEur },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/source not found/);
  });

  it('200 on valid same-currency merge (pipeline is a no-op until Task 2)', async () => {
    const scratch = await createAccount(cookie, 'MergeValScratch', 'EUR');
    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${scratch}/merge`,
      headers: { cookie }, payload: { targetId: tgtEur },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().merged).toBeNull();
  });
});
