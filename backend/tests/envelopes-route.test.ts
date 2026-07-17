// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let expenseCatId: number;
let incomeCatId: number;

describe.skipIf(!RUN)('/api/envelopes/assignments', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'env-user', password: 'env-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'env-user', password: 'env-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
    const exp = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie }, payload: { name: 'Alimentation', kind: 'expense' },
    });
    expenseCatId = exp.json().category.id;
    const inc = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie }, payload: { name: 'Salaire', kind: 'income' },
    });
    incomeCatId = inc.json().category.id;
  });

  it('rejects PUT without auth', async () => {
    const r = await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments',
      payload: { categoryId: expenseCatId, month: '2026-07', amount: '100.00' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('rejects PUT for income category', async () => {
    const r = await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments',
      headers: { cookie },
      payload: { categoryId: incomeCatId, month: '2026-07', amount: '100.00' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('category_not_expense');
  });

  it('upserts assignment (create then update)', async () => {
    const create = await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments',
      headers: { cookie },
      payload: { categoryId: expenseCatId, month: '2026-07', amount: '450.00' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().assignment.amount).toBe('450.00');
    expect(create.json().assignment.month).toBe('2026-07');

    const update = await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments',
      headers: { cookie },
      payload: { categoryId: expenseCatId, month: '2026-07', amount: '500.00' },
    });
    expect(update.statusCode).toBe(201);
    expect(update.json().assignment.amount).toBe('500.00');
  });

  it('accepts negative amounts', async () => {
    const r = await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments',
      headers: { cookie },
      payload: { categoryId: expenseCatId, month: '2026-08', amount: '-30.00' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().assignment.amount).toBe('-30.00');
  });

  it('lists this user\'s assignments for a month', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/envelopes/assignments?month=2026-07',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    const rows = r.json().assignments;
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe('500.00');
  });

  it('DELETE 404s on unknown id', async () => {
    const r = await app.inject({
      method: 'DELETE', url: '/api/envelopes/assignments/999999',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe.skipIf(!RUN)('/api/envelopes/reallocate', () => {
  let catA: number;
  let catB: number;
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'realloc-user', password: 'realloc-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'realloc-user', password: 'realloc-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
    const a = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie }, payload: { name: 'A', kind: 'expense' },
    });
    catA = a.json().category.id;
    const b = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie }, payload: { name: 'B', kind: 'expense' },
    });
    catB = b.json().category.id;
    await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments', headers: { cookie },
      payload: { categoryId: catA, month: '2026-07', amount: '100.00' },
    });
    await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments', headers: { cookie },
      payload: { categoryId: catB, month: '2026-07', amount: '50.00' },
    });
  });

  it('subtracts from source and adds to dest atomically', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/envelopes/reallocate', headers: { cookie },
      payload: { fromCategoryId: catA, toCategoryId: catB, month: '2026-07', amount: '30.00' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().from.amount).toBe('70.00');
    expect(r.json().to.amount).toBe('80.00');
  });

  it('creates a zero-based source row if none exists this month', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/envelopes/reallocate', headers: { cookie },
      payload: { fromCategoryId: catA, toCategoryId: catB, month: '2026-09', amount: '10.00' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().from.amount).toBe('-10.00');
    expect(r.json().to.amount).toBe('10.00');
  });

  it('rejects same category', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/envelopes/reallocate', headers: { cookie },
      payload: { fromCategoryId: catA, toCategoryId: catA, month: '2026-07', amount: '5.00' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('same_category');
  });
});

describe.skipIf(!RUN)('/api/envelopes/categories', () => {
  let cat: number;
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'settings-user', password: 'settings-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'settings-user', password: 'settings-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
    const c = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Vacances', kind: 'expense' },
    });
    cat = c.json().category.id;
  });

  it('upserts settings for a category', async () => {
    const r = await app.inject({
      method: 'PUT', url: `/api/envelopes/categories/${cat}`, headers: { cookie },
      payload: {
        targetAmount: '1200.00',
        targetDate: '2026-12-01',
        targetKind: 'save_by_date',
        overspendPolicy: 'reallocate_manual',
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().settings.targetAmount).toBe('1200.00');
    expect(r.json().settings.overspendPolicy).toBe('reallocate_manual');
  });

  it('rejects bad targetKind', async () => {
    const r = await app.inject({
      method: 'PUT', url: `/api/envelopes/categories/${cat}`, headers: { cookie },
      payload: { targetKind: 'bogus' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects targetAmount without targetKind', async () => {
    const r = await app.inject({
      method: 'PUT', url: `/api/envelopes/categories/${cat}`, headers: { cookie },
      payload: { targetAmount: '500.00' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('lists settings for user', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/envelopes/categories', headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().settings).toHaveLength(1);
  });

  it('deletes settings', async () => {
    const r = await app.inject({
      method: 'DELETE', url: `/api/envelopes/categories/${cat}`, headers: { cookie },
    });
    expect(r.statusCode).toBe(204);
    const list = await app.inject({
      method: 'GET', url: '/api/envelopes/categories', headers: { cookie },
    });
    expect(list.json().settings).toHaveLength(0);
  });
});

describe.skipIf(!RUN)('/api/envelopes/holds', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'holds-user', password: 'holds-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'holds-user', password: 'holds-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  });

  it('creates a hold', async () => {
    const r = await app.inject({
      method: 'PUT', url: '/api/envelopes/holds', headers: { cookie },
      payload: { month: '2026-07', amount: '500.00' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().hold.amount).toBe('500.00');
    expect(r.json().hold.month).toBe('2026-07');
  });

  it('lists holds in a range', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/envelopes/holds?from=2026-01&to=2026-12',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().holds).toHaveLength(1);
  });

  it('deletes hold when amount = 0', async () => {
    const r = await app.inject({
      method: 'PUT', url: '/api/envelopes/holds', headers: { cookie },
      payload: { month: '2026-07', amount: '0.00' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().deleted).toBe(true);
    const list = await app.inject({
      method: 'GET', url: '/api/envelopes/holds?from=2026-01&to=2026-12',
      headers: { cookie },
    });
    expect(list.json().holds).toHaveLength(0);
  });
});

describe.skipIf(!RUN)('GET /api/envelopes/report', () => {
  let expA: number;
  let incC: number;
  let acct: number;
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'report-user', password: 'report-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'report-user', password: 'report-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
    const a = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Alimentation', kind: 'expense' },
    });
    expA = a.json().category.id;
    const inc = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Salaire', kind: 'income' },
    });
    incC = inc.json().category.id;
    const ac = await app.inject({
      method: 'POST', url: '/api/accounts', headers: { cookie },
      payload: { name: 'Compte', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2026-01-01' },
    });
    acct = ac.json().account.id;
    // Income of 1000 in June, spend of 200 in June under Alimentation.
    await app.inject({
      method: 'POST', url: '/api/transactions', headers: { cookie },
      payload: {
        accountId: acct, date: '2026-06-01', amount: '1000.00',
        rawLabel: 'Salaire', normalizedLabel: 'salaire',
        categoryId: incC, dedupKey: 'inc-1',
      },
    });
    await app.inject({
      method: 'POST', url: '/api/transactions', headers: { cookie },
      payload: {
        accountId: acct, date: '2026-06-15', amount: '-200.00',
        rawLabel: 'Courses', normalizedLabel: 'courses',
        categoryId: expA, dedupKey: 'sp-1',
      },
    });
    // Assign 300 in June under Alimentation
    await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments', headers: { cookie },
      payload: { categoryId: expA, month: '2026-06', amount: '300.00' },
    });
  });

  it('returns pool + rows for the requested month', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/envelopes/report?month=2026-06',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.month).toBe('2026-06');
    expect(body.pool.incomeCumulative).toBe('1000.00');
    expect(body.pool.assignedCumulative).toBe('300.00');
    expect(body.pool.available).toBe('700.00');
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].categoryId).toBe(expA);
    expect(body.rows[0].assignment).toBe('300.00');
    expect(body.rows[0].spend).toBe('200.00');
    expect(body.rows[0].balance).toBe('100.00');
    expect(body.rows[0].overspent).toBe(false);
  });

  // A refund posted against an expense category (positive amount) must net
  // against payments in the same category rather than double-counting as
  // spend. This is what enables single-category tracking of things like
  // Impôts where a refund occasionally arrives — spend reflects the true
  // net outflow, matching the -SUM(amount) convention used in reports.ts.
  it('nets an occasional refund against payments in the same expense category', async () => {
    await app.inject({
      method: 'POST', url: '/api/transactions', headers: { cookie },
      payload: {
        accountId: acct, date: '2026-06-20', amount: '50.00',
        rawLabel: 'Remboursement courses', normalizedLabel: 'remboursement courses',
        categoryId: expA, dedupKey: 'refund-1',
      },
    });
    const r = await app.inject({
      method: 'GET', url: '/api/envelopes/report?month=2026-06',
      headers: { cookie },
    });
    const body = r.json();
    expect(body.rows[0].spend).toBe('150.00');
    expect(body.rows[0].balance).toBe('150.00');
  });
});
