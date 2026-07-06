// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let accountEURId: number;
let accountUSDId: number;
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

describe.skipIf(!RUN)('/api/reports', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'reports-user', password: 'reports-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'reports-user', password: 'reports-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const eur = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'REUR', type: 'checking', currency: 'EUR', openingBalance: '1000', openingDate: '2025-01-01' },
    });
    accountEURId = eur.json().account.id;
    const usd = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'RUSD', type: 'checking', currency: 'USD', openingBalance: '500', openingDate: '2025-01-01' },
    });
    accountUSDId = usd.json().account.id;

    const cat = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie },
      payload: { name: 'RepCourses', kind: 'expense' },
    });
    categoryId = cat.json().category.id;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { transactions } = await import('../src/db/schema.js');
    await db.delete(transactions);
  });

  describe('GET /api/reports/balance', () => {
    it('groups totals per currency and returns available separately', async () => {
      await makeTx({ accountId: accountEURId, date: '2026-06-15', amount: '-100.00', rawLabel: 'a' });
      await makeTx({ accountId: accountUSDId, date: '2026-06-15', amount: '50.00', rawLabel: 'b' });

      const res = await app.inject({
        method: 'GET', url: '/api/reports/balance',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const perCurrency = res.json().perCurrency;
      const eur = perCurrency.find((r: { currency: string }) => r.currency === 'EUR');
      const usd = perCurrency.find((r: { currency: string }) => r.currency === 'USD');
      // EUR: 1000 opening - 100 = 900
      expect(Number(eur.total)).toBeCloseTo(900);
      expect(Number(eur.available)).toBeCloseTo(900);
      // USD: 500 opening + 50 = 550
      expect(Number(usd.total)).toBeCloseTo(550);
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/reports/balance' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/reports/timeseries', () => {
    it('returns cumulative balance per account per day', async () => {
      await makeTx({ accountId: accountEURId, date: '2026-06-15', amount: '-100.00', rawLabel: 'a' });
      await makeTx({ accountId: accountEURId, date: '2026-06-16', amount: '-50.00', rawLabel: 'b' });

      const res = await app.inject({
        method: 'GET', url: '/api/reports/timeseries',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const points = res.json().points.filter((p: { account_id: number }) => p.account_id === accountEURId);
      // opening (2025-01-01) + two tx buckets = 3 rows for the EUR account.
      expect(points.length).toBeGreaterThanOrEqual(3);
      // Cumulative should be monotonic non-strict along the sorted date sequence.
      const cums = points.map((p: { cumulative: string }) => Number(p.cumulative));
      // Final cumulative: 1000 - 100 - 50 = 850.
      expect(cums[cums.length - 1]).toBeCloseTo(850);
    });

    it('honors the granularity=month parameter', async () => {
      await makeTx({ accountId: accountEURId, date: '2026-06-15', amount: '-10.00', rawLabel: 'a' });
      await makeTx({ accountId: accountEURId, date: '2026-06-20', amount: '-20.00', rawLabel: 'b' });
      const res = await app.inject({
        method: 'GET', url: '/api/reports/timeseries?granularity=month',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const juneRows = res.json().points.filter(
        (p: { account_id: number; bucket: string }) =>
          p.account_id === accountEURId && p.bucket.startsWith('2026-06'),
      );
      // Both June transactions collapse into one monthly bucket.
      expect(juneRows).toHaveLength(1);
    });

    it('rejects an invalid date range with 400', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/reports/timeseries?fromDate=15-06-2026',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/reports/categories', () => {
    it('groups by category × month with signed totals', async () => {
      await makeTx({ accountId: accountEURId, date: '2026-06-15', amount: '-30.00', rawLabel: 'x', categoryId });
      await makeTx({ accountId: accountEURId, date: '2026-06-20', amount: '-20.00', rawLabel: 'y', categoryId });
      const res = await app.inject({
        method: 'GET', url: '/api/reports/categories?fromDate=2026-06-01&toDate=2026-06-30',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const rows = res.json().rows.filter(
        (r: { category_id: number | null }) => r.category_id === categoryId,
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].total)).toBeCloseTo(-50);
      expect(rows[0].transaction_count).toBe(2);
    });

    it('rejects an invalid query with 400', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/reports/categories?fromDate=bogus',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(400);
    });

    it('splits contribute to their split category, parent contributes nothing', async () => {
      // 1) Plain -50 tx tagged to categoryId (baseline).
      await makeTx({
        accountId: accountEURId, date: '2026-06-15', amount: '-50.00',
        rawLabel: 'plain', categoryId,
      });
      // 2) -100 tx whose own category points at categoryId but whose SPLITS
      //    ignore it — the split subtotal for categoryId must NOT count the
      //    parent's own attribution.
      const splitTxId = await makeTx({
        accountId: accountEURId, date: '2026-06-15', amount: '-100.00',
        rawLabel: 'Amazon', categoryId,
      });
      const otherCatRes = await app.inject({
        method: 'POST', url: '/api/categories', headers: { cookie },
        payload: { name: 'RepOther', kind: 'expense' },
      });
      const otherCatId = otherCatRes.json().category.id;

      await app.inject({
        method: 'PUT', url: `/api/transactions/${splitTxId}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId: otherCatId, amount: '-70.00' },
          { categoryId, amount: '-30.00' },
        ] },
      });

      const res = await app.inject({
        method: 'GET', url: '/api/reports/categories?fromDate=2026-06-01&toDate=2026-06-30',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const rows = res.json().rows as Array<{ category_id: number; total: string }>;
      const expense = rows.find((r) => r.category_id === categoryId)!;
      const other = rows.find((r) => r.category_id === otherCatId)!;
      // -50 (plain) + -30 (split contribution) = -80; parent's own -100 tag contributes nothing.
      expect(Number(expense.total)).toBeCloseTo(-80.0, 2);
      // -70 from the split.
      expect(Number(other.total)).toBeCloseTo(-70.0, 2);
    });
  });
});
