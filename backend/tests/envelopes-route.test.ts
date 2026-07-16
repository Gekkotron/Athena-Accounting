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
    expect(create.json().assignment.month).toBe('2026-07-01');

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
