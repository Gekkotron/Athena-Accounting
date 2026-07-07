// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let accountAId: number;
let accountBId: number;
let categoryId: number;

async function makeTx(payload: Record<string, unknown>): Promise<number> {
  const res = await app.inject({
    method: 'POST', url: '/api/transactions',
    headers: { cookie }, payload,
  });
  if (res.statusCode !== 201) {
    throw new Error(`expected 201 got ${res.statusCode}: ${res.body}`);
  }
  return res.json().transaction.id;
}

describe.skipIf(!RUN)('/api/transactions', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'tx-user', password: 'transactions-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'tx-user', password: 'transactions-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const a = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'TxA', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    accountAId = a.json().account.id;
    const b = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'TxB', type: 'savings', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    accountBId = b.json().account.id;

    const cat = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie },
      payload: { name: 'Courses', kind: 'expense' },
    });
    categoryId = cat.json().category.id;
  });

  afterEach(async () => {
    // Drop every transaction for the test user so groups reset between cases.
    const { db } = await import('../src/db/client.js');
    const { transactions } = await import('../src/db/schema.js');
    await db.delete(transactions);
  });

  describe('POST /api/transactions', () => {
    it('creates a manual transaction with derived normalized_label + dedup_key', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/transactions',
        headers: { cookie },
        payload: { accountId: accountAId, date: '2026-06-15', amount: '-42.30', rawLabel: 'CB CARREFOUR' },
      });
      expect(res.statusCode).toBe(201);
      const tx = res.json().transaction;
      expect(tx.rawLabel).toBe('CB CARREFOUR');
      expect(tx.normalizedLabel).toBe('carrefour');
      expect(tx.amount).toBe('-42.30');
      expect(tx.dedupKey).toMatch(/^hash:/);
    });

    it('applies the rule engine when categoryId is omitted', async () => {
      // Seed a rule that catches a highly-specific keyword so it can't
      // collide with any default seeded by onboarding.
      const ruleRes = await app.inject({
        method: 'POST', url: '/api/rules',
        headers: { cookie },
        payload: { categoryId, keyword: 'ruletestunique', matchMode: 'word', signConstraint: 'negative' },
      });
      expect(ruleRes.statusCode).toBe(201);
      const res = await app.inject({
        method: 'POST', url: '/api/transactions',
        headers: { cookie },
        payload: { accountId: accountAId, date: '2026-06-15', amount: '-10.00', rawLabel: 'CB RULETESTUNIQUE MERCHANT' },
      });
      expect(res.statusCode).toBe(201);
      const tx = res.json().transaction;
      expect(tx.categoryId).toBe(categoryId);
      expect(tx.categorySource).toBe('auto');
    });

    it('flags category_source=manual when categoryId is provided explicitly', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/transactions',
        headers: { cookie },
        payload: { accountId: accountAId, date: '2026-06-15', amount: '-5.00', rawLabel: 'x', categoryId },
      });
      expect(res.json().transaction.categorySource).toBe('manual');
    });

    it('rejects an exact duplicate with 409', async () => {
      const payload = { accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'DUP' };
      const a = await app.inject({ method: 'POST', url: '/api/transactions', headers: { cookie }, payload });
      expect(a.statusCode).toBe(201);
      const b = await app.inject({ method: 'POST', url: '/api/transactions', headers: { cookie }, payload });
      expect(b.statusCode).toBe(409);
      expect(b.json().error).toMatch(/identique/i);
    });

    it('rejects an unknown accountId with 400', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/transactions',
        headers: { cookie },
        payload: { accountId: 999999, date: '2026-06-15', amount: '1.00', rawLabel: 'x' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid input with 400', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/transactions',
        headers: { cookie },
        payload: { accountId: accountAId, date: 'bad-date', amount: 'nope', rawLabel: '' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('accepts lockYears on create', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/transactions',
        headers: { cookie },
        payload: { accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'lock', lockYears: 3 },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().transaction.lockYears).toBe(3);
    });
  });

  describe('GET /api/transactions', () => {
    it('lists with pagination + total', async () => {
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-10.00', rawLabel: 'a' });
      await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '-20.00', rawLabel: 'b' });
      await makeTx({ accountId: accountAId, date: '2026-06-17', amount: '-30.00', rawLabel: 'c' });

      const res = await app.inject({
        method: 'GET', url: '/api/transactions?limit=2&offset=0',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.transactions).toHaveLength(2);
      expect(body.pagination.total).toBe(3);
      expect(body.pagination.limit).toBe(2);
    });

    it('filters by accountId', async () => {
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'on-a' });
      await makeTx({ accountId: accountBId, date: '2026-06-15', amount: '-2.00', rawLabel: 'on-b' });
      const res = await app.inject({
        method: 'GET', url: `/api/transactions?accountId=${accountAId}`,
        headers: { cookie },
      });
      expect(res.json().transactions).toHaveLength(1);
      expect(res.json().transactions[0].rawLabel).toBe('on-a');
    });

    it('filters by date range', async () => {
      await makeTx({ accountId: accountAId, date: '2026-05-01', amount: '-1.00', rawLabel: 'may' });
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-2.00', rawLabel: 'jun' });
      await makeTx({ accountId: accountAId, date: '2026-07-01', amount: '-3.00', rawLabel: 'jul' });
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?fromDate=2026-06-01&toDate=2026-06-30',
        headers: { cookie },
      });
      expect(res.json().transactions).toHaveLength(1);
      expect(res.json().transactions[0].rawLabel).toBe('jun');
    });

    it('filters by exact amount (sign-agnostic)', async () => {
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-42.30', rawLabel: 'debit' });
      await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '42.30', rawLabel: 'credit' });
      await makeTx({ accountId: accountAId, date: '2026-06-17', amount: '-42.31', rawLabel: 'other' });
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?amount=42.30',
        headers: { cookie },
      });
      expect(res.json().transactions).toHaveLength(2);
    });

    it('treats a bare integer as a range (19 -> 19.00..19.99, sign-agnostic)', async () => {
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '19.00', rawLabel: 'lo' });
      await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '19.72', rawLabel: 'mid' });
      await makeTx({ accountId: accountAId, date: '2026-06-17', amount: '-19.50', rawLabel: 'neg' });
      await makeTx({ accountId: accountAId, date: '2026-06-18', amount: '20.00', rawLabel: 'above' });
      await makeTx({ accountId: accountAId, date: '2026-06-19', amount: '18.99', rawLabel: 'below' });
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?amount=19',
        headers: { cookie },
      });
      const labels = res.json().transactions.map((t: { rawLabel: string }) => t.rawLabel).sort();
      expect(labels).toEqual(['lo', 'mid', 'neg']);
    });

    it('keeps an explicit-decimal amount an exact match (19.72 stays exact)', async () => {
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '19.72', rawLabel: 'exact' });
      await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '19.00', rawLabel: 'noise' });
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?amount=19.72',
        headers: { cookie },
      });
      const labels = res.json().transactions.map((t: { rawLabel: string }) => t.rawLabel);
      expect(labels).toEqual(['exact']);
    });

    it('search matches raw_label case-insensitively', async () => {
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'CB CARREFOUR' });
      await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '-1.00', rawLabel: 'PAIEMENT MONOPRIX' });
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?search=carrefour',
        headers: { cookie },
      });
      expect(res.json().transactions).toHaveLength(1);
      expect(res.json().transactions[0].rawLabel).toBe('CB CARREFOUR');
    });

    it('search matches memo case-insensitively', async () => {
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'AMZN MKTP' });
      // memo isn't a create-body field — set it via PATCH after creation.
      const id = await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '-2.00', rawLabel: 'ORDINARY' });
      const { db } = await import('../src/db/client.js');
      const { transactions } = await import('../src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      await db.update(transactions).set({ memo: 'ID: NFX-42' }).where(eq(transactions.id, id));
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?search=NFX',
        headers: { cookie },
      });
      expect(res.json().transactions).toHaveLength(1);
      expect(res.json().transactions[0].id).toBe(id);
    });

    it('search matches notes case-insensitively', async () => {
      const id = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'VIR IBAN123' });
      await app.inject({
        method: 'PATCH', url: `/api/transactions/${id}`,
        headers: { cookie },
        payload: { notes: 'facture netflix' },
      });
      await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '-1.00', rawLabel: 'OTHER' });
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?search=netflix',
        headers: { cookie },
      });
      expect(res.json().transactions).toHaveLength(1);
      expect(res.json().transactions[0].id).toBe(id);
    });

    it('search is accent-insensitive across notes', async () => {
      const id = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'X' });
      await app.inject({
        method: 'PATCH', url: `/api/transactions/${id}`,
        headers: { cookie },
        payload: { notes: 'café' },
      });
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?search=cafe',
        headers: { cookie },
      });
      expect(res.json().transactions).toHaveLength(1);
      expect(res.json().transactions[0].id).toBe(id);
    });

    it('search returns nothing when the needle matches no field', async () => {
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'CB CARREFOUR' });
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?search=xyzzy',
        headers: { cookie },
      });
      expect(res.json().transactions).toHaveLength(0);
    });

    it('sorts by amount desc', async () => {
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-10.00', rawLabel: 'a' });
      await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '-99.00', rawLabel: 'b' });
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?sort=amount&order=desc',
        headers: { cookie },
      });
      const rows = res.json().transactions;
      expect(rows[0].amount).toBe('-10.00');
      expect(rows[1].amount).toBe('-99.00');
    });

    it('returns 400 on an invalid filter shape', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?fromDate=15-06-2026',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/transactions/:id', () => {
    it('returns the transaction', async () => {
      const id = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'x' });
      const res = await app.inject({
        method: 'GET', url: `/api/transactions/${id}`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().transaction.id).toBe(id);
    });

    it('returns 404 for a missing id', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/transactions/999999',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/transactions/:id', () => {
    it('updates only the fields present in the patch', async () => {
      const id = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'x' });
      const res = await app.inject({
        method: 'PATCH', url: `/api/transactions/${id}`,
        headers: { cookie },
        payload: { notes: 'hello' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().transaction.notes).toBe('hello');
      // Amount unchanged.
      expect(res.json().transaction.amount).toBe('-1.00');
    });

    it('categoryId patch flips category_source to manual', async () => {
      const id = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'x' });
      const res = await app.inject({
        method: 'PATCH', url: `/api/transactions/${id}`,
        headers: { cookie },
        payload: { categoryId },
      });
      expect(res.json().transaction.categoryId).toBe(categoryId);
      expect(res.json().transaction.categorySource).toBe('manual');
    });

    it('re-derives normalized_label when rawLabel changes', async () => {
      const id = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'x' });
      const res = await app.inject({
        method: 'PATCH', url: `/api/transactions/${id}`,
        headers: { cookie },
        payload: { rawLabel: 'CB MONOPRIX' },
      });
      expect(res.json().transaction.normalizedLabel).toBe('monoprix');
    });

    it('accepts lockYears null to clear the override', async () => {
      const id = await makeTx({
        accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'lk', lockYears: 5,
      });
      const res = await app.inject({
        method: 'PATCH', url: `/api/transactions/${id}`,
        headers: { cookie },
        payload: { lockYears: null },
      });
      expect(res.json().transaction.lockYears).toBeNull();
    });

    it('returns 400 when the patch has no fields', async () => {
      const id = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'x' });
      const res = await app.inject({
        method: 'PATCH', url: `/api/transactions/${id}`,
        headers: { cookie }, payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for a missing id', async () => {
      const res = await app.inject({
        method: 'PATCH', url: '/api/transactions/999999',
        headers: { cookie }, payload: { notes: 'x' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/transactions/:id', () => {
    it('deletes and returns ok', async () => {
      const id = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'x' });
      const del = await app.inject({
        method: 'DELETE', url: `/api/transactions/${id}`,
        headers: { cookie },
      });
      expect(del.statusCode).toBe(200);
      const list = await app.inject({
        method: 'GET', url: '/api/transactions',
        headers: { cookie },
      });
      expect(list.json().transactions).toHaveLength(0);
    });

    it('returns 400 for a non-integer id', async () => {
      const res = await app.inject({
        method: 'DELETE', url: '/api/transactions/not-an-id',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/transactions/delete-bulk', () => {
    it('deletes multiple ids in one call', async () => {
      const ids = [
        await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'a' }),
        await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '-2.00', rawLabel: 'b' }),
        await makeTx({ accountId: accountAId, date: '2026-06-17', amount: '-3.00', rawLabel: 'c' }),
      ];
      const res = await app.inject({
        method: 'POST', url: '/api/transactions/delete-bulk',
        headers: { cookie },
        payload: { ids: ids.slice(0, 2) },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(2);
      const list = await app.inject({
        method: 'GET', url: '/api/transactions',
        headers: { cookie },
      });
      expect(list.json().transactions).toHaveLength(1);
      expect(list.json().transactions[0].id).toBe(ids[2]);
    });

    it('rejects an empty or malformed ids array with 400', async () => {
      const empty = await app.inject({
        method: 'POST', url: '/api/transactions/delete-bulk',
        headers: { cookie }, payload: { ids: [] },
      });
      expect(empty.statusCode).toBe(400);
      const bad = await app.inject({
        method: 'POST', url: '/api/transactions/delete-bulk',
        headers: { cookie }, payload: { ids: 'nope' },
      });
      expect(bad.statusCode).toBe(400);
    });
  });

  describe('POST /api/transactions/mark-not-duplicate', () => {
    it('flips notDuplicate=true for the given ids', async () => {
      const id = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'x' });
      const res = await app.inject({
        method: 'POST', url: '/api/transactions/mark-not-duplicate',
        headers: { cookie }, payload: { ids: [id] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().updated).toBe(1);

      const get = await app.inject({
        method: 'GET', url: `/api/transactions/${id}`,
        headers: { cookie },
      });
      expect(get.json().transaction.notDuplicate).toBe(true);
    });

    it('rejects an empty ids array with 400', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/transactions/mark-not-duplicate',
        headers: { cookie }, payload: { ids: [] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/transactions/duplicates', () => {
    it('surfaces a group when the same (account, date, amount) has different dedup_keys', async () => {
      // Two rows: same account/date/amount, different labels → different
      // normalized_label → different dedup_key.
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-42.30', rawLabel: 'CB CARREFOUR' });
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-42.30', rawLabel: 'PAIEMENT MONOPRIX' });

      const res = await app.inject({
        method: 'GET', url: '/api/transactions/duplicates',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.groups).toHaveLength(1);
      expect(body.groups[0].transactions).toHaveLength(2);
    });

    it('hides a group once every row is marked notDuplicate', async () => {
      const a = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'A' });
      const b = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'B' });
      await app.inject({
        method: 'POST', url: '/api/transactions/mark-not-duplicate',
        headers: { cookie }, payload: { ids: [a, b] },
      });
      const res = await app.inject({
        method: 'GET', url: '/api/transactions/duplicates',
        headers: { cookie },
      });
      expect(res.json().groups).toEqual([]);
    });

    it('filters to a single account when accountId is provided', async () => {
      // Labels must normalize to different values so the dedup constraint
      // doesn't reject the second insert on each account. "onA-1" and
      // "onA-2" both normalize to "ona-" (the trailing digit is stripped),
      // so use fully distinct words.
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'MERCHANT ALPHA' });
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'MERCHANT BETA' });
      await makeTx({ accountId: accountBId, date: '2026-06-15', amount: '-1.00', rawLabel: 'MERCHANT GAMMA' });
      await makeTx({ accountId: accountBId, date: '2026-06-15', amount: '-1.00', rawLabel: 'MERCHANT DELTA' });

      const res = await app.inject({
        method: 'GET', url: `/api/transactions/duplicates?accountId=${accountAId}`,
        headers: { cookie },
      });
      const groups = res.json().groups;
      expect(groups).toHaveLength(1);
      expect(groups[0].accountId).toBe(accountAId);
    });

    it('rejects a bad accountId with 400', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/transactions/duplicates?accountId=nope',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('auth', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/transactions',
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
