// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;

describe.skipIf(!RUN)('/api/accounts', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'ac-user', password: 'accounts-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'ac-user', password: 'accounts-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { accounts, transactions, bankConnections } = await import('../src/db/schema.js');
    await db.delete(transactions);
    // bank_connection_accounts cascades from bank_connections and
    // ON DELETE SET NULL from accounts, so clearing bank_connections first
    // frees the FK before we drop accounts.
    await db.delete(bankConnections);
    await db.delete(accounts);
  });

  it('creates an account with defaults', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'Main', type: 'checking', openingDate: '2025-01-01' },
    });
    expect(res.statusCode).toBe(201);
    const a = res.json().account;
    expect(a.currency).toBe('EUR');
    expect(a.openingBalance).toBe('0.00');
  });

  it('rejects a duplicate account name with 409', async () => {
    await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'Same', type: 'checking', openingDate: '2025-01-01' },
    });
    const dup = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'Same', type: 'savings', openingDate: '2025-01-01' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('rejects an invalid currency with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'X', type: 'checking', currency: 'euro', openingDate: '2025-01-01' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid openingDate with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'Y', type: 'checking', openingDate: '01-01-2025' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists accounts with computed current_balance and counts', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'ListA', type: 'checking', currency: 'EUR', openingBalance: '100', openingDate: '2025-01-01' },
    });
    const accId = created.json().account.id;
    // Post a tx and check current_balance is opening + tx.
    await app.inject({
      method: 'POST', url: '/api/transactions',
      headers: { cookie },
      payload: { accountId: accId, date: '2026-06-15', amount: '-25.30', rawLabel: 'x' },
    });
    const list = await app.inject({
      method: 'GET', url: '/api/accounts', headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const acc = list.json().accounts.find((a: { id: number }) => a.id === accId);
    expect(Number(acc.currentBalance)).toBeCloseTo(74.7);
    expect(acc.transactionCount).toBe(1);
  });

  it('fetches a single account via GET /:id', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'Single', type: 'checking', openingDate: '2025-01-01' },
    });
    const id = created.json().account.id;
    const res = await app.inject({
      method: 'GET', url: `/api/accounts/${id}`, headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().account.name).toBe('Single');
  });

  it('GET /:id returns 404 for a missing id', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/accounts/999999', headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PUT updates an account', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'Old', type: 'checking', openingDate: '2025-01-01' },
    });
    const id = created.json().account.id;
    const put = await app.inject({
      method: 'PUT', url: `/api/accounts/${id}`,
      headers: { cookie }, payload: { name: 'Renamed', lockYears: 5 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().account.name).toBe('Renamed');
    expect(put.json().account.lockYears).toBe(5);
  });

  it('PUT sets and clears closedAt', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'Closable', type: 'checking', openingDate: '2025-01-01' },
    });
    const id = created.json().account.id;
    expect(created.json().account.closedAt).toBeNull();

    const set = await app.inject({
      method: 'PUT', url: `/api/accounts/${id}`,
      headers: { cookie }, payload: { closedAt: '2026-06-30' },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().account.closedAt).toBe('2026-06-30');

    // Regression: the list endpoint must surface closedAt too. The PUT
    // persists it fine, but if GET /api/accounts drops the column, the
    // UI never sees the update — no badge, and re-opening the edit form
    // shows an empty date.
    const list = await app.inject({
      method: 'GET', url: '/api/accounts', headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const listed = list.json().accounts.find((a: { id: number }) => a.id === id);
    expect(listed.closedAt).toBe('2026-06-30');

    const clear = await app.inject({
      method: 'PUT', url: `/api/accounts/${id}`,
      headers: { cookie }, payload: { closedAt: null },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json().account.closedAt).toBeNull();
  });

  it('PUT rejects a malformed closedAt with 400', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'BadClose', type: 'checking', openingDate: '2025-01-01' },
    });
    const id = created.json().account.id;
    const bad = await app.inject({
      method: 'PUT', url: `/api/accounts/${id}`,
      headers: { cookie }, payload: { closedAt: '30-06-2026' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("PUT switches type to 'investment'", async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'Binance', type: 'checking', openingDate: '2025-01-01' },
    });
    const id = created.json().account.id;
    expect(created.json().account.type).toBe('checking');
    const put = await app.inject({
      method: 'PUT', url: `/api/accounts/${id}`,
      headers: { cookie }, payload: { type: 'investment' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().account.type).toBe('investment');
    const list = await app.inject({
      method: 'GET', url: '/api/accounts', headers: { cookie },
    });
    const acc = list.json().accounts.find((a: { id: number }) => a.id === id);
    expect(acc.type).toBe('investment');
  });

  it('PUT rejects empty patch with 400', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'Any', type: 'checking', openingDate: '2025-01-01' },
    });
    const id = created.json().account.id;
    const put = await app.inject({
      method: 'PUT', url: `/api/accounts/${id}`,
      headers: { cookie }, payload: {},
    });
    expect(put.statusCode).toBe(400);
  });

  it('PUT returns 404 for missing id', async () => {
    const put = await app.inject({
      method: 'PUT', url: '/api/accounts/999999',
      headers: { cookie }, payload: { name: 'x' },
    });
    expect(put.statusCode).toBe(404);
  });

  it('DELETE happy-path', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'Gone', type: 'checking', openingDate: '2025-01-01' },
    });
    const id = created.json().account.id;
    const del = await app.inject({
      method: 'DELETE', url: `/api/accounts/${id}`, headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
  });

  it('DELETE refuses when the account still has transactions (409)', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'HasTx', type: 'checking', openingDate: '2025-01-01' },
    });
    const id = created.json().account.id;
    await app.inject({
      method: 'POST', url: '/api/transactions',
      headers: { cookie },
      payload: { accountId: id, date: '2026-06-15', amount: '-1.00', rawLabel: 'x' },
    });
    const del = await app.inject({
      method: 'DELETE', url: `/api/accounts/${id}`, headers: { cookie },
    });
    expect(del.statusCode).toBe(409);
  });

  it('DELETE returns 404 for missing id', async () => {
    const del = await app.inject({
      method: 'DELETE', url: '/api/accounts/999999', headers: { cookie },
    });
    expect(del.statusCode).toBe(404);
  });

  it('PUT /api/accounts/order reassigns display_order', async () => {
    const a = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'A', type: 'checking', openingDate: '2025-01-01' },
    });
    const b = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'B', type: 'checking', openingDate: '2025-01-01' },
    });
    const aId = a.json().account.id;
    const bId = b.json().account.id;
    // Reorder B, A.
    const res = await app.inject({
      method: 'PUT', url: '/api/accounts/order',
      headers: { cookie }, payload: { ids: [bId, aId] },
    });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({
      method: 'GET', url: '/api/accounts', headers: { cookie },
    });
    const rows = list.json().accounts;
    expect(rows[0].id).toBe(bId);
    expect(rows[1].id).toBe(aId);
  });

  it('reorder rejects duplicate ids with 400', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/accounts/order',
      headers: { cookie }, payload: { ids: [1, 1] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('reorder rejects empty ids array with 400', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/accounts/order',
      headers: { cookie }, payload: { ids: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unauthenticated with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/accounts' });
    expect(res.statusCode).toBe(401);
  });

  it('create accepts an IBAN and the list returns it with ibanLocked=false', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: {
        name: 'ManualIban', type: 'checking', openingDate: '2025-01-01',
        iban: 'fr76 1234 5678 9012 3456 7890 123',
      },
    });
    expect(created.statusCode).toBe(201);
    // Create endpoint returns the raw row; the compact IBAN was persisted.
    expect(created.json().account.iban).toBe('FR7612345678901234567890123');

    const list = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
    const row = list.json().accounts.find((a: { name: string }) => a.name === 'ManualIban');
    expect(row.iban).toBe('FR7612345678901234567890123');
    expect(row.ibanLocked).toBe(false);
  });

  it('PUT rejects an IBAN change when the account is synced (ibanLocked)', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'Synced', type: 'checking', openingDate: '2025-01-01' },
    });
    const acc = created.json().account;

    // Simulate the bank-sync side: a connection + a mapped bca row with an
    // IBAN. The crud guard checks EXISTS(bca WHERE account_id AND iban != '').
    const { db } = await import('../src/db/client.js');
    const { bankConnections, bankConnectionAccounts, users } = await import('../src/db/schema.js');
    const [me] = await db.select().from(users).where(
      (await import('drizzle-orm')).eq(users.username, 'ac-user'),
    );
    const [conn] = await db.insert(bankConnections).values({
      userId: me.id,
      sessionId: 'sess-1',
      aspspName: 'TestBank',
      aspspCountry: 'FR',
      validUntil: '2030-01-01',
    }).returning();
    await db.insert(bankConnectionAccounts).values({
      connectionId: conn.id,
      bankAccountUid: 'uid-1',
      iban: 'FR7612345678901234567890123',
      accountId: acc.id,
    });

    const res = await app.inject({
      method: 'PUT', url: `/api/accounts/${acc.id}`,
      headers: { cookie },
      payload: { iban: 'FR9900000000000000000000011' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/bank sync/i);

    // Non-iban updates on the same account still succeed.
    const nameRes = await app.inject({
      method: 'PUT', url: `/api/accounts/${acc.id}`,
      headers: { cookie },
      payload: { name: 'Renamed' },
    });
    expect(nameRes.statusCode).toBe(200);
  });
});
