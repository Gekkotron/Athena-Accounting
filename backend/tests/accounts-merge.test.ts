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

  it('200 on valid same-currency merge (validation-only path returns null merged)', async () => {
    // In Task 2+ this same call would return counts; the validation-only
    // path is superseded once the pipeline lands. Keeping the test wired
    // through the same describe would leak state from earlier cases.
    // Task 2's dedicated pipeline describe below has its own beforeAll,
    // so nothing to assert here beyond 200.
    const scratch = await createAccount(cookie, 'MergeValScratch', 'EUR');
    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${scratch}/merge`,
      headers: { cookie }, payload: { targetId: tgtEur },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    // After Task 2, this returns merged counts (not null). We keep the loose
    // assertion so validation tests remain green through the pipeline landing.
    expect(res.json()).toHaveProperty('merged');
  });
});

describe.skipIf(!RUN)('POST /api/accounts/:sourceId/merge — transactions pipeline', () => {
  let cookie: string;

  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    cookie = await setupUser('merge-tx-user', 'merge-tx-1234');
  });

  afterAll(async () => { await app.close(); });

  async function postTx(
    accountId: number, date: string, amount: string,
    rawLabel: string, extra: Record<string, unknown> = {},
  ): Promise<number> {
    const res = await app.inject({
      method: 'POST', url: '/api/transactions',
      headers: { cookie },
      payload: { accountId, date, amount, rawLabel, ...extra },
    });
    if (res.statusCode !== 201) {
      throw new Error(`create tx failed ${res.statusCode}: ${res.body}`);
    }
    return res.json().transaction.id;
  }

  it('moves all transactions from source to target (happy path)', async () => {
    const src = await createAccount(cookie, 'TxSrc', 'EUR', '100');
    const tgt = await createAccount(cookie, 'TxTgt', 'EUR', '50');
    await postTx(src, '2026-06-01', '-10.00', 'a');
    await postTx(src, '2026-06-02', '-20.00', 'b');
    await postTx(src, '2026-06-03', '-30.00', 'c');
    await postTx(tgt, '2026-05-01', '5.00', 'x');
    await postTx(tgt, '2026-05-02', '6.00', 'y');

    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${src}/merge`,
      headers: { cookie }, payload: { targetId: tgt },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().merged.transactionsMoved).toBe(3);
    expect(res.json().merged.dedupCollisionsDropped).toBe(0);

    const { db } = await import('../src/db/client.js');
    const { transactions } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const targetTxs = await db.select().from(transactions).where(eq(transactions.accountId, tgt));
    expect(targetTxs.length).toBe(5);
  });

  it('drops source transactions that collide by dedup_key with the target', async () => {
    const src = await createAccount(cookie, 'DedupSrc', 'EUR');
    const tgt = await createAccount(cookie, 'DedupTgt', 'EUR');
    await postTx(src, '2026-06-10', '-42.00', 'dupe');
    await postTx(tgt, '2026-06-10', '-42.00', 'dupe');
    await postTx(src, '2026-06-11', '-7.00', 'unique');

    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${src}/merge`,
      headers: { cookie }, payload: { targetId: tgt },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().merged.dedupCollisionsDropped).toBe(1);
    expect(res.json().merged.transactionsMoved).toBe(1);

    const { db } = await import('../src/db/client.js');
    const { transactions } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const targetTxs = await db.select().from(transactions).where(eq(transactions.accountId, tgt));
    expect(targetTxs.length).toBe(2);
  });

  it('preserves source lock_years by promoting it to per-row before the move', async () => {
    const { db } = await import('../src/db/client.js');
    const { accounts, transactions } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');

    const src = await createAccount(cookie, 'LockSrc', 'EUR');
    const tgt = await createAccount(cookie, 'LockTgt', 'EUR');
    await db.update(accounts).set({ lockYears: 5 }).where(eq(accounts.id, src));
    await postTx(src, '2026-07-01', '-1.00', 'nolock');

    await app.inject({
      method: 'POST', url: `/api/accounts/${src}/merge`,
      headers: { cookie }, payload: { targetId: tgt },
    });

    const [tx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, tgt));
    expect(tx?.lockYears).toBe(5);
  });
});
