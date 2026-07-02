// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let accountId: number;
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

describe.skipIf(!RUN)('/api/tri', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'tri-user', password: 'tri-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'tri-user', password: 'tri-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const acc = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'TriAcc', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    accountId = acc.json().account.id;

    const cat = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie },
      payload: { name: 'TriCat', kind: 'expense' },
    });
    categoryId = cat.json().category.id;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { transactions, rules } = await import('../src/db/schema.js');
    await db.delete(transactions);
    await db.delete(rules);
  });

  describe('GET /api/tri/groups', () => {
    it('surfaces uncategorized transactions grouped by normalized_label', async () => {
      // Two rows share a normalized_label after prefix strip; one is unique.
      await makeTx({ accountId, date: '2026-06-15', amount: '-1.00', rawLabel: 'CB CARREFOUR PARIS' });
      await makeTx({ accountId, date: '2026-06-16', amount: '-2.00', rawLabel: 'CB CARREFOUR PARIS' });
      // WAIT — same rawLabel would trigger 409 dedup. Change date to make dedup_key differ.
      // Actually the two above have DIFFERENT dates so different dedup_key.
      await makeTx({ accountId, date: '2026-06-17', amount: '-3.00', rawLabel: 'PAIEMENT SNCF' });

      const res = await app.inject({
        method: 'GET', url: '/api/tri/groups', headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Two groups (carrefour paris, sncf), ordered by count desc.
      expect(body.groups.length).toBeGreaterThanOrEqual(2);
      expect(body.groups[0].transaction_count).toBeGreaterThanOrEqual(2);
      expect(body.pagination.total).toBeGreaterThanOrEqual(2);
    });

    it('honors limit + offset', async () => {
      // Distinct normalized labels → distinct groups.
      for (const label of ['ALPHA', 'BETA', 'GAMMA', 'DELTA']) {
        await makeTx({ accountId, date: '2026-06-15', amount: '-1.00', rawLabel: label });
      }
      const res = await app.inject({
        method: 'GET', url: '/api/tri/groups?limit=2&offset=1', headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().groups).toHaveLength(2);
    });

    it('rejects invalid query with 400', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/tri/groups?limit=nope', headers: { cookie },
      });
      expect(res.statusCode).toBe(400);
    });

    it('excludes internal transfers from the groups', async () => {
      // A transfer-tagged row shouldn't appear (transfer_group_id NOT NULL).
      // Simulate by inserting one directly with a group id.
      const { db } = await import('../src/db/client.js');
      const { transactions } = await import('../src/db/schema.js');
      const { randomUUID } = await import('node:crypto');
      const { computeDedupKey } = await import('../src/domain/imports/dedup.js');
      const { normalizeLabel } = await import('../src/domain/imports/normalize.js');
      const listMe = await app.inject({
        method: 'GET', url: '/api/auth/me', headers: { cookie },
      });
      const uid = listMe.json().user.id;
      const rawLabel = 'VIREMENT INTERNE';
      const normalized = normalizeLabel(rawLabel);
      await db.insert(transactions).values({
        userId: uid,
        accountId,
        date: '2026-06-15',
        amount: '-10.00',
        rawLabel,
        normalizedLabel: normalized,
        dedupKey: computeDedupKey({ accountId, date: '2026-06-15', amount: '-10.00', normalizedLabel: normalized, fitid: null }),
        transferGroupId: randomUUID(),
      });
      const res = await app.inject({
        method: 'GET', url: '/api/tri/groups', headers: { cookie },
      });
      // The virement transaction shouldn't surface.
      const labels: string[] = res.json().groups.map((g: { normalized_label: string }) => g.normalized_label);
      expect(labels.every((l) => !l.includes('interne') && !l.includes('viremement'))).toBe(true);
    });
  });

  describe('POST /api/tri/assign', () => {
    it('bulk-assigns a category to every row of a normalized_label', async () => {
      await makeTx({ accountId, date: '2026-06-15', amount: '-1.00', rawLabel: 'CB TRIMERCHANT' });
      await makeTx({ accountId, date: '2026-06-16', amount: '-2.00', rawLabel: 'CB TRIMERCHANT' });

      const res = await app.inject({
        method: 'POST', url: '/api/tri/assign',
        headers: { cookie },
        payload: { groups: [{ normalizedLabel: 'trimerchant', categoryId }] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().assigned).toBe(2);
      expect(res.json().rulesCreated).toBe(0);
    });

    it('optionally creates a matching rule when createRules=true', async () => {
      await makeTx({ accountId, date: '2026-06-15', amount: '-1.00', rawLabel: 'CB WITHRULE' });
      const before = await app.inject({ method: 'GET', url: '/api/rules', headers: { cookie } });
      const beforeCount = before.json().rules.length;

      const res = await app.inject({
        method: 'POST', url: '/api/tri/assign',
        headers: { cookie },
        payload: { groups: [{ normalizedLabel: 'withrule', categoryId }], createRules: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().rulesCreated).toBe(1);

      const after = await app.inject({ method: 'GET', url: '/api/rules', headers: { cookie } });
      expect(after.json().rules.length).toBe(beforeCount + 1);
      const rule = after.json().rules.find(
        (r: { keyword: string }) => r.keyword === 'withrule',
      );
      expect(rule).toBeTruthy();
      expect(rule.signConstraint).toBe('negative'); // expense category → negative
    });

    it('rejects a categoryId that does not exist with 400', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/tri/assign',
        headers: { cookie },
        payload: { groups: [{ normalizedLabel: 'x', categoryId: 999999 }] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects an empty groups array with 400', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/tri/assign',
        headers: { cookie },
        payload: { groups: [] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it('rejects unauthenticated with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tri/groups' });
    expect(res.statusCode).toBe(401);
  });
});
