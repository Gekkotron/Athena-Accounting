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

describe.skipIf(!RUN)('POST /api/accounts/:sourceId/merge — side tables + finalize', () => {
  let cookie: string;

  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    cookie = await setupUser('merge-side-user', 'merge-side-1234');
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

  it('collapses transfer groups whose legs are now all on target', async () => {
    const { db } = await import('../src/db/client.js');
    const { transactions } = await import('../src/db/schema.js');
    const { eq, inArray } = await import('drizzle-orm');

    const src = await createAccount(cookie, 'XferSrc', 'EUR');
    const tgt = await createAccount(cookie, 'XferTgt', 'EUR');
    const legA = await postTx(src, '2026-06-01', '-100.00', 'xferA');
    const legB = await postTx(tgt, '2026-06-01', '100.00', 'xferB');
    const groupId = '11111111-1111-1111-1111-111111111111';
    await db.update(transactions)
      .set({ transferGroupId: groupId })
      .where(inArray(transactions.id, [legA, legB]));

    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${src}/merge`,
      headers: { cookie }, payload: { targetId: tgt },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().merged.transferGroupsCollapsed).toBe(1);

    const rows = await db.select().from(transactions).where(eq(transactions.accountId, tgt));
    expect(rows.every((r) => r.transferGroupId === null)).toBe(true);
  });

  it('repoints filename patterns, checkpoints, budgets, imports, templates', async () => {
    const { db } = await import('../src/db/client.js');
    const {
      accountFilenamePatterns, balanceCheckpoints, categoryBudgets, categories,
      fileImports, pdfStatementTemplates,
    } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');

    const src = await createAccount(cookie, 'SideSrc', 'EUR');
    const tgt = await createAccount(cookie, 'SideTgt', 'EUR');

    const { users } = await import('../src/db/schema.js');
    const [u] = await db.select().from(users).where(eq(users.username, 'merge-side-user'));
    const uid = u!.id;

    await db.insert(accountFilenamePatterns).values({
      userId: uid, pattern: 'side-*.ofx', accountId: src, priority: 0,
    });
    await db.insert(balanceCheckpoints).values({
      userId: uid, accountId: src, checkpointDate: '2026-04-01', expectedAmount: '10.00',
    });
    const [cat] = await db.insert(categories).values({
      userId: uid, name: 'SideBudgetCat', kind: 'expense',
    }).returning();
    await db.insert(categoryBudgets).values({
      userId: uid, categoryId: cat.id, monthlyLimit: '100.00',
      currency: 'EUR', period: 'monthly', accountId: src,
    });
    await db.insert(fileImports).values({
      userId: uid, filename: 'side.ofx', accountId: src, format: 'ofx',
      totalLines: 0, insertedCount: 0, dedupSkipped: 0,
    });
    await db.insert(pdfStatementTemplates).values({
      userId: uid, accountId: src, fingerprint: 'side-fp', label: 'side',
      zones: {}, source: 'interactive',
    });

    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${src}/merge`,
      headers: { cookie }, payload: { targetId: tgt },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().merged.patternsMoved).toBe(1);
    expect(res.json().merged.checkpointsMoved).toBe(1);
    expect(res.json().merged.budgetsMoved).toBe(1);
    expect(res.json().merged.importsMoved).toBe(1);
    expect(res.json().merged.templatesMoved).toBe(1);

    const pats = await db.select().from(accountFilenamePatterns).where(eq(accountFilenamePatterns.accountId, tgt));
    expect(pats.length).toBe(1);
    const cps = await db.select().from(balanceCheckpoints).where(eq(balanceCheckpoints.accountId, tgt));
    expect(cps.length).toBe(1);
    const buds = await db.select().from(categoryBudgets).where(eq(categoryBudgets.accountId, tgt));
    expect(buds.length).toBe(1);
    const imps = await db.select().from(fileImports).where(eq(fileImports.accountId, tgt));
    expect(imps.length).toBe(1);
    const tpls = await db.select().from(pdfStatementTemplates).where(eq(pdfStatementTemplates.accountId, tgt));
    expect(tpls.length).toBe(1);
  });

  it('sums opening_balance onto target and deletes the source', async () => {
    const src = await createAccount(cookie, 'OpBalSrc', 'EUR', '100.00');
    const tgt = await createAccount(cookie, 'OpBalTgt', 'EUR', '50.00');

    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${src}/merge`,
      headers: { cookie }, payload: { targetId: tgt },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().merged.openingBalanceAdded).toBe('100.00');

    const tgtRes = await app.inject({
      method: 'GET', url: `/api/accounts/${tgt}`,
      headers: { cookie },
    });
    expect(tgtRes.json().account.openingBalance).toBe('150.00');

    const srcRes = await app.inject({
      method: 'GET', url: `/api/accounts/${src}`,
      headers: { cookie },
    });
    expect(srcRes.statusCode).toBe(404);
  });
});
