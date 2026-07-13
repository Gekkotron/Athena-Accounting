// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let expenseCatId: number;
let incomeCatId: number;

describe.skipIf(!RUN)('/api/budgets', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'budget-user', password: 'budget-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'budget-user', password: 'budget-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const exp = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie }, payload: { name: 'Restaurants', kind: 'expense' },
    });
    expenseCatId = exp.json().category.id;
    const inc = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie }, payload: { name: 'Salaire', kind: 'income' },
    });
    incomeCatId = inc.json().category.id;
  });

  it('creates, lists, updates, and deletes a budget', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/budgets',
      headers: { cookie }, payload: { categoryId: expenseCatId, monthlyLimit: '300.00' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().budget.id;
    expect(created.json().budget.currency).toBe('EUR');

    const list = await app.inject({ method: 'GET', url: '/api/budgets', headers: { cookie } });
    expect(list.json().budgets).toHaveLength(1);

    const updated = await app.inject({
      method: 'PUT', url: `/api/budgets/${id}`,
      headers: { cookie }, payload: { monthlyLimit: '450.00' },
    });
    expect(updated.json().budget.monthlyLimit).toBe('450.00');

    const del = await app.inject({ method: 'DELETE', url: `/api/budgets/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
  });

  it('rejects a duplicate category with 409', async () => {
    await app.inject({
      method: 'POST', url: '/api/budgets',
      headers: { cookie }, payload: { categoryId: expenseCatId, monthlyLimit: '100.00' },
    });
    const dup = await app.inject({
      method: 'POST', url: '/api/budgets',
      headers: { cookie }, payload: { categoryId: expenseCatId, monthlyLimit: '200.00' },
    });
    expect(dup.statusCode).toBe(409);
    // cleanup
    const list = await app.inject({ method: 'GET', url: '/api/budgets', headers: { cookie } });
    for (const b of list.json().budgets) {
      await app.inject({ method: 'DELETE', url: `/api/budgets/${b.id}`, headers: { cookie } });
    }
  });

  it('rejects a non-expense category with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/budgets',
      headers: { cookie }, payload: { categoryId: incomeCatId, monthlyLimit: '100.00' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-positive limit with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/budgets',
      headers: { cookie }, payload: { categoryId: expenseCatId, monthlyLimit: '0' },
    });
    expect(res.statusCode).toBe(400);
  });

  it("does not leak or mutate another user's budgets (cross-user isolation)", async () => {
    const { db } = await import('../src/db/client.js');
    const { users, categories, categoryBudgets } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');

    // Second user with their own expense category + budget, inserted directly
    // (onboarding refuses a second user after the first-run account exists).
    const [otherUser] = await db.insert(users).values({
      username: 'other-user-budgets', passwordHash: 'x',
    }).returning();
    const [otherCat] = await db.insert(categories).values({
      userId: otherUser!.id, name: 'Autre Resto', kind: 'expense',
    }).returning();
    const [otherBudget] = await db.insert(categoryBudgets).values({
      userId: otherUser!.id, categoryId: otherCat!.id, monthlyLimit: '500.00', currency: 'EUR',
    }).returning();

    // The first user must not see the other user's budget in their list.
    const list = await app.inject({ method: 'GET', url: '/api/budgets', headers: { cookie } });
    expect(list.json().budgets.some((b: { id: number }) => b.id === otherBudget!.id)).toBe(false);

    // And must not be able to update or delete it — 404, never 200/204.
    const put = await app.inject({
      method: 'PUT', url: `/api/budgets/${otherBudget!.id}`,
      headers: { cookie }, payload: { monthlyLimit: '1.00' },
    });
    expect(put.statusCode).toBe(404);
    const del = await app.inject({
      method: 'DELETE', url: `/api/budgets/${otherBudget!.id}`, headers: { cookie },
    });
    expect(del.statusCode).toBe(404);

    // The other user's budget is untouched.
    const [still] = await db.select().from(categoryBudgets).where(eq(categoryBudgets.id, otherBudget!.id));
    expect(still?.monthlyLimit).toBe('500.00');

    // Cleanup — cascades to the category + budget.
    await db.delete(users).where(eq(users.id, otherUser!.id));
  });

  it('creates monthly + yearly budgets for the same category', async () => {
    const monthly = await app.inject({
      method: 'POST', url: '/api/budgets', headers: { cookie },
      payload: { categoryId: expenseCatId, monthlyLimit: '50.00', period: 'monthly' },
    });
    expect(monthly.statusCode).toBe(201);
    expect(monthly.json().budget.period).toBe('monthly');

    const yearly = await app.inject({
      method: 'POST', url: '/api/budgets', headers: { cookie },
      payload: { categoryId: expenseCatId, monthlyLimit: '600.00', period: 'yearly' },
    });
    expect(yearly.statusCode).toBe(201);
    expect(yearly.json().budget.period).toBe('yearly');

    // cleanup
    for (const id of [monthly.json().budget.id, yearly.json().budget.id]) {
      await app.inject({ method: 'DELETE', url: `/api/budgets/${id}`, headers: { cookie } });
    }
  });

  it('rejects two global monthly budgets for the same category with 409', async () => {
    const first = await app.inject({
      method: 'POST', url: '/api/budgets', headers: { cookie },
      payload: { categoryId: expenseCatId, monthlyLimit: '50.00' },
    });
    expect(first.statusCode).toBe(201);
    const dup = await app.inject({
      method: 'POST', url: '/api/budgets', headers: { cookie },
      payload: { categoryId: expenseCatId, monthlyLimit: '80.00' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('budget_exists');
    expect(dup.json().categoryId).toBe(expenseCatId);
    expect(dup.json().period).toBe('monthly');
    expect(dup.json().accountId).toBe(null);
    await app.inject({ method: 'DELETE', url: `/api/budgets/${first.json().budget.id}`, headers: { cookie } });
  });

  it('allows a global + account-scoped budget for the same category+period', async () => {
    // Create an account for this test.
    const accRes = await app.inject({
      method: 'POST', url: '/api/accounts', headers: { cookie },
      payload: { name: 'Test Card', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2026-01-01' },
    });
    const accountId = accRes.json().account.id;

    const g = await app.inject({
      method: 'POST', url: '/api/budgets', headers: { cookie },
      payload: { categoryId: expenseCatId, monthlyLimit: '50.00', accountId: null },
    });
    const s = await app.inject({
      method: 'POST', url: '/api/budgets', headers: { cookie },
      payload: { categoryId: expenseCatId, monthlyLimit: '20.00', accountId },
    });
    expect(g.statusCode).toBe(201);
    expect(s.statusCode).toBe(201);
    expect(s.json().budget.accountId).toBe(accountId);

    // Second account-scoped budget on same (cat, period, account) → 409.
    const dup = await app.inject({
      method: 'POST', url: '/api/budgets', headers: { cookie },
      payload: { categoryId: expenseCatId, monthlyLimit: '25.00', accountId },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().accountId).toBe(accountId);

    // cleanup
    for (const id of [g.json().budget.id, s.json().budget.id]) {
      await app.inject({ method: 'DELETE', url: `/api/budgets/${id}`, headers: { cookie } });
    }
    await app.inject({ method: 'DELETE', url: `/api/accounts/${accountId}`, headers: { cookie } });
  });

  it('rejects an accountId that does not belong to the user with 400', async () => {
    const { db } = await import('../src/db/client.js');
    const { users, accounts } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');

    const [otherUser] = await db.insert(users).values({
      username: 'other-user-budgets-acct', passwordHash: 'x',
    }).returning();
    const [otherAcc] = await db.insert(accounts).values({
      userId: otherUser!.id, name: 'Foreign', type: 'checking', currency: 'EUR',
      openingBalance: '0', openingDate: '2026-01-01',
    }).returning();

    const res = await app.inject({
      method: 'POST', url: '/api/budgets', headers: { cookie },
      payload: { categoryId: expenseCatId, monthlyLimit: '50.00', accountId: otherAcc!.id },
    });
    expect(res.statusCode).toBe(400);

    await db.delete(users).where(eq(users.id, otherUser!.id));
  });

  it('rejects an invalid period with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/budgets', headers: { cookie },
      payload: { categoryId: expenseCatId, monthlyLimit: '50.00', period: 'quarterly' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('cascades account deletion to account-scoped budgets, leaves global untouched', async () => {
    const accRes = await app.inject({
      method: 'POST', url: '/api/accounts', headers: { cookie },
      payload: { name: 'Deletable', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2026-01-01' },
    });
    const accountId = accRes.json().account.id;

    const g = await app.inject({
      method: 'POST', url: '/api/budgets', headers: { cookie },
      payload: { categoryId: expenseCatId, monthlyLimit: '50.00' },
    });
    const s = await app.inject({
      method: 'POST', url: '/api/budgets', headers: { cookie },
      payload: { categoryId: expenseCatId, monthlyLimit: '20.00', accountId },
    });

    await app.inject({ method: 'DELETE', url: `/api/accounts/${accountId}`, headers: { cookie } });

    const list = await app.inject({ method: 'GET', url: '/api/budgets', headers: { cookie } });
    const budgets = list.json().budgets;
    expect(budgets.some((b: { id: number }) => b.id === s.json().budget.id)).toBe(false); // cascaded away
    expect(budgets.some((b: { id: number }) => b.id === g.json().budget.id)).toBe(true);  // survives
    await app.inject({ method: 'DELETE', url: `/api/budgets/${g.json().budget.id}`, headers: { cookie } });
  });

  it('GET /api/budgets returns period and accountId on each row', async () => {
    const c = await app.inject({
      method: 'POST', url: '/api/budgets', headers: { cookie },
      payload: { categoryId: expenseCatId, monthlyLimit: '50.00' },
    });
    const list = await app.inject({ method: 'GET', url: '/api/budgets', headers: { cookie } });
    const row = list.json().budgets.find((b: { id: number }) => b.id === c.json().budget.id);
    expect(row.period).toBe('monthly');
    expect(row.accountId).toBe(null);
    await app.inject({ method: 'DELETE', url: `/api/budgets/${c.json().budget.id}`, headers: { cookie } });
  });
});
