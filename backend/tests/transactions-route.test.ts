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

    it('treats a 1-decimal amount as a range (55.5 -> 55.50..55.59, sign-agnostic)', async () => {
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '55.50', rawLabel: 'lo' });
      await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '55.57', rawLabel: 'mid' });
      await makeTx({ accountId: accountAId, date: '2026-06-17', amount: '-55.59', rawLabel: 'neg' });
      await makeTx({ accountId: accountAId, date: '2026-06-18', amount: '55.60', rawLabel: 'above' });
      await makeTx({ accountId: accountAId, date: '2026-06-19', amount: '55.49', rawLabel: 'below' });
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?amount=55.5',
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

  describe('GET /api/transactions running balance', () => {
    it('attaches runningBalance per row when accountId is set', async () => {
      await makeTx({ accountId: accountAId, date: '2026-01-01', amount: '100.00', rawLabel: 'RB-A' });
      await makeTx({ accountId: accountAId, date: '2026-01-02', amount: '-30.00', rawLabel: 'RB-B' });
      await makeTx({ accountId: accountAId, date: '2026-01-03', amount: '-4.50', rawLabel: 'RB-C' });

      const res = await app.inject({
        method: 'GET',
        url: `/api/transactions?accountId=${accountAId}&sort=date&order=asc`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const txs = res.json().transactions as Array<{ rawLabel: string; runningBalance?: string }>;
      const byLabel = Object.fromEntries(txs.map((t) => [t.rawLabel, t.runningBalance]));
      expect(byLabel['RB-A']).toBe('100.00');
      expect(byLabel['RB-B']).toBe('70.00');
      expect(byLabel['RB-C']).toBe('65.50');
    });

    it('omits runningBalance when no accountId is given', async () => {
      await makeTx({ accountId: accountAId, date: '2026-01-01', amount: '100.00', rawLabel: 'RB-NOACC' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/transactions',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const txs = res.json().transactions as Array<{ runningBalance?: string }>;
      expect(txs.every((t) => t.runningBalance === undefined)).toBe(true);
    });

    it('folds hidden transfer rows into the balance even though the list omits them by default', async () => {
      // Two normal, visible rows around a transfer-tagged row seeded by direct
      // DB insert (same pattern as tri-route.test.ts's transfer-exclusion
      // case and cfea163's matched-tx seed): `includeTransfers` defaults to
      // false, so the transfer row must never surface in `transactions`, yet
      // the running balance must still accumulate its amount for every row
      // dated after it.
      await makeTx({ accountId: accountAId, date: '2026-03-01', amount: '100.00', rawLabel: 'RBX-A' });
      await makeTx({ accountId: accountAId, date: '2026-03-03', amount: '5.00', rawLabel: 'RBX-C' });

      const { db } = await import('../src/db/client.js');
      const { transactions } = await import('../src/db/schema.js');
      const { computeDedupKey } = await import('../src/domain/imports/dedup.js');
      const { normalizeLabel } = await import('../src/domain/imports/normalize.js');
      const { randomUUID } = await import('node:crypto');

      const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
      const uid = me.json().user.id;

      const rawLabel = 'RBX-TRANSFER-HIDDEN';
      const normalizedLabel = normalizeLabel(rawLabel);
      await db.insert(transactions).values({
        userId: uid,
        accountId: accountAId,
        date: '2026-03-02',
        amount: '-20.00',
        rawLabel,
        normalizedLabel,
        dedupKey: computeDedupKey({
          accountId: accountAId, date: '2026-03-02', amount: '-20.00', normalizedLabel, fitid: null,
        }),
        transferGroupId: randomUUID(),
      });

      // No includeTransfers param: the transfer row must be hidden from the list.
      const res = await app.inject({
        method: 'GET',
        url: `/api/transactions?accountId=${accountAId}&sort=date&order=asc`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const txs = res.json().transactions as Array<{ rawLabel: string; runningBalance?: string }>;

      expect(txs.some((t) => t.rawLabel === rawLabel)).toBe(false);

      const byLabel = Object.fromEntries(txs.map((t) => [t.rawLabel, t.runningBalance]));
      // opening 0 + 100.00 (RBX-A) = 100.00.
      expect(byLabel['RBX-A']).toBe('100.00');
      // ... + (-20.00 hidden transfer, 03-02) + 5.00 (RBX-C, 03-03) = 85.00.
      // If the balance ignored the hidden transfer this would read 105.00.
      expect(byLabel['RBX-C']).toBe('85.00');
    });

    it('excludes transactions dated before the account opening date, matching currentBalance', async () => {
      // The running balance uses the same basis as currentBalance: only
      // transactions on/after opening_date count. A pre-opening row is still
      // listed but gets no balance entry (renders "—" in the UI); a post-opening
      // row's balance must NOT include the pre-opening amount.
      const acc = await app.inject({
        method: 'POST', url: '/api/accounts',
        headers: { cookie },
        payload: { name: 'TxOpen', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2026-06-01' },
      });
      const openAccId = acc.json().account.id;

      await makeTx({ accountId: openAccId, date: '2026-05-01', amount: '999.00', rawLabel: 'PRE-OPEN' });
      await makeTx({ accountId: openAccId, date: '2026-06-02', amount: '100.00', rawLabel: 'POST-OPEN' });

      const res = await app.inject({
        method: 'GET',
        url: `/api/transactions?accountId=${openAccId}&sort=date&order=asc`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const txs = res.json().transactions as Array<{ rawLabel: string; runningBalance?: string }>;
      const byLabel = Object.fromEntries(txs.map((t) => [t.rawLabel, t.runningBalance]));

      // Both rows are still listed (the list itself isn't date-filtered)...
      expect(txs.some((t) => t.rawLabel === 'PRE-OPEN')).toBe(true);
      expect(txs.some((t) => t.rawLabel === 'POST-OPEN')).toBe(true);
      // ...but the pre-opening row has no balance entry.
      expect(byLabel['PRE-OPEN']).toBeUndefined();
      // opening 0 + 100.00, EXCLUDING the 999.00 pre-opening amount. If the
      // opening-date bound were missing this would read 1099.00.
      expect(byLabel['POST-OPEN']).toBe('100.00');
    });

    it('renders same-day rows in balance-chronology order when sorted asc', async () => {
      // Two rows on the same day. The running-balance history accumulates in
      // insertion order (id asc), so the list must render them id-asc when the
      // user picks `order=asc` — otherwise the top-to-bottom `runningBalance`
      // chain reads backwards within the day (regression from before the
      // list's id tie-breaker was tied to `dir`).
      const firstId = await makeTx({ accountId: accountAId, date: '2026-04-01', amount: '-10.00', rawLabel: 'SAME-A' });
      const secondId = await makeTx({ accountId: accountAId, date: '2026-04-01', amount: '-5.00', rawLabel: 'SAME-B' });
      expect(secondId).toBeGreaterThan(firstId);

      const res = await app.inject({
        method: 'GET',
        url: `/api/transactions?accountId=${accountAId}&sort=date&order=asc`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const txs = res.json().transactions as Array<{ id: number; rawLabel: string; runningBalance?: string }>;
      const idxA = txs.findIndex((t) => t.rawLabel === 'SAME-A');
      const idxB = txs.findIndex((t) => t.rawLabel === 'SAME-B');
      // SAME-A (smaller id, applied first) must appear above SAME-B.
      expect(idxA).toBeLessThan(idxB);
      // And its balance must be the pre-B balance, not post-B.
      expect(txs[idxA]?.runningBalance).toBe('-10.00');
      expect(txs[idxB]?.runningBalance).toBe('-15.00');
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

  describe('POST /api/transactions/categorize-bulk', () => {
    it('updates categoryId + categorySource=manual for every eligible id', async () => {
      const ids = [
        await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'a' }),
        await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '-2.00', rawLabel: 'b' }),
      ];
      const res = await app.inject({
        method: 'POST', url: '/api/transactions/categorize-bulk',
        headers: { cookie }, payload: { ids, categoryId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ updated: 2, skipped: 0 });

      const list = await app.inject({
        method: 'GET', url: '/api/transactions',
        headers: { cookie },
      });
      for (const tx of list.json().transactions) {
        expect(tx.categoryId).toBe(categoryId);
        expect(tx.categorySource).toBe('manual');
      }
    });

    it('categoryId=null clears the category and still flips categorySource to manual', async () => {
      const id = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'a' });
      // First give it a category so the clear is observable.
      await app.inject({
        method: 'PATCH', url: `/api/transactions/${id}`,
        headers: { cookie }, payload: { categoryId },
      });
      const res = await app.inject({
        method: 'POST', url: '/api/transactions/categorize-bulk',
        headers: { cookie }, payload: { ids: [id], categoryId: null },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ updated: 1, skipped: 0 });

      const get = await app.inject({
        method: 'GET', url: `/api/transactions/${id}`,
        headers: { cookie },
      });
      expect(get.json().transaction.categoryId).toBeNull();
      expect(get.json().transaction.categorySource).toBe('manual');
    });

    it('skips transfer legs and split parents; only eligible rows are updated', async () => {
      // Direct DB seed for the transfer leg — the app has no "link two rows
      // as a transfer" HTTP endpoint (transfer_group_id is set at import
      // time by the auto-detector or restore path). This mirrors the existing
      // hidden-transfer test at line 358+ of this file.
      const { db } = await import('../src/db/client.js');
      const { transactions } = await import('../src/db/schema.js');
      const { randomUUID } = await import('node:crypto');
      const { eq } = await import('drizzle-orm');

      const plain = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'plain' });
      const legA = await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '-100.00', rawLabel: 'legA' });
      // Mirror what detectTransfers does in production: mark as transfer leg
      // AND clear any auto-assigned category (the POST /api/transactions path
      // runs the rule engine, which will have set a default category here).
      await db.update(transactions)
        .set({ transferGroupId: randomUUID(), categoryId: null })
        .where(eq(transactions.id, legA));

      // Split parent: two splits summing to the parent's amount.
      const parent = await makeTx({ accountId: accountAId, date: '2026-06-17', amount: '-30.00', rawLabel: 'split-parent' });
      const splitRes = await app.inject({
        method: 'PUT', url: `/api/transactions/${parent}/splits`,
        headers: { cookie },
        payload: { splits: [
          { categoryId, amount: '-20.00', memo: null },
          { categoryId, amount: '-10.00', memo: null },
        ] },
      });
      expect(splitRes.statusCode).toBe(200);

      const res = await app.inject({
        method: 'POST', url: '/api/transactions/categorize-bulk',
        headers: { cookie },
        payload: { ids: [plain, legA, parent], categoryId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ updated: 1, skipped: 2 });

      const plainRow = await app.inject({
        method: 'GET', url: `/api/transactions/${plain}`,
        headers: { cookie },
      });
      expect(plainRow.json().transaction.categoryId).toBe(categoryId);
      const legARow = await app.inject({
        method: 'GET', url: `/api/transactions/${legA}`,
        headers: { cookie },
      });
      expect(legARow.json().transaction.categoryId).toBeNull();
    });

    it('counts unknown ids and cross-user ids as skipped', async () => {
      const own = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'own' });
      const res = await app.inject({
        method: 'POST', url: '/api/transactions/categorize-bulk',
        headers: { cookie },
        payload: { ids: [own, 999_999_999], categoryId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ updated: 1, skipped: 1 });
    });

    it('returns 400 catégorie inconnue on an FK violation', async () => {
      const id = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'x' });
      const res = await app.inject({
        method: 'POST', url: '/api/transactions/categorize-bulk',
        headers: { cookie },
        payload: { ids: [id], categoryId: 999_999_999 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/catégorie inconnue/i);
    });

    it('rejects an empty or malformed body with 400', async () => {
      const empty = await app.inject({
        method: 'POST', url: '/api/transactions/categorize-bulk',
        headers: { cookie }, payload: { ids: [], categoryId: null },
      });
      expect(empty.statusCode).toBe(400);
      const bad = await app.inject({
        method: 'POST', url: '/api/transactions/categorize-bulk',
        headers: { cookie }, payload: { ids: 'nope', categoryId: null },
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
