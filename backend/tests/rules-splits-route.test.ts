// Rule-driven auto-splits (migration 0042). PGlite-gated — runs under
// RUN_DB_TESTS=1 with DB_DRIVER=pglite.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let primaryCategoryId: number;
let splitCategoryA: number;
let splitCategoryB: number;

describe.skipIf(!RUN)('/api/rules with splits payload', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'rules-splits-user', password: 'rules-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'rules-splits-user', password: 'rules-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    // Three categories: the rule's "primary" + two split targets.
    const primary = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Retail', kind: 'expense' },
    });
    primaryCategoryId = primary.json().category.id;
    const a = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Livres', kind: 'expense' },
    });
    splitCategoryA = a.json().category.id;
    const b = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Electro', kind: 'expense' },
    });
    splitCategoryB = b.json().category.id;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { rules, ruleSplits } = await import('../src/db/schema.js');
    // Cascade takes rule_splits with the parent rule.
    void ruleSplits;
    await db.delete(rules);
  });

  it('POST creates a rule with splits atomically', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/rules', headers: { cookie },
      payload: {
        categoryId: primaryCategoryId,
        keyword: 'amazon',
        splits: [
          { categoryId: splitCategoryA, percent: 70 },
          { categoryId: splitCategoryB, percent: 30 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const rule = res.json().rule;
    expect(rule.splits).toHaveLength(2);
    expect(rule.splits[0]).toMatchObject({ categoryId: splitCategoryA, percent: 70 });
    expect(rule.splits[1]).toMatchObject({ categoryId: splitCategoryB, percent: 30 });
  });

  it('POST returns 400 when splits do not sum to 100', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/rules', headers: { cookie },
      payload: {
        categoryId: primaryCategoryId,
        keyword: 'amazon',
        splits: [
          { categoryId: splitCategoryA, percent: 70 },
          { categoryId: splitCategoryB, percent: 20 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/100/);
  });

  it('POST returns 400 when a split categoryId is not owned by the caller', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/rules', headers: { cookie },
      payload: {
        categoryId: primaryCategoryId,
        keyword: 'amazon',
        splits: [
          { categoryId: splitCategoryA, percent: 70 },
          { categoryId: 999_999, percent: 30 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/catégorie/i);
  });

  it('POST rejects fewer than 2 splits via zod schema', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/rules', headers: { cookie },
      payload: {
        categoryId: primaryCategoryId,
        keyword: 'amazon',
        splits: [{ categoryId: splitCategoryA, percent: 100 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET hydrates splits per rule', async () => {
    await app.inject({
      method: 'POST', url: '/api/rules', headers: { cookie },
      payload: {
        categoryId: primaryCategoryId, keyword: 'amazon',
        splits: [
          { categoryId: splitCategoryA, percent: 40 },
          { categoryId: splitCategoryB, percent: 60 },
        ],
      },
    });
    await app.inject({
      method: 'POST', url: '/api/rules', headers: { cookie },
      payload: { categoryId: primaryCategoryId, keyword: 'boulangerie' },
    });
    const res = await app.inject({
      method: 'GET', url: '/api/rules', headers: { cookie },
    });
    const rulesList = res.json().rules;
    expect(rulesList).toHaveLength(2);
    const amazon = rulesList.find((r: { keyword: string }) => r.keyword === 'amazon')!;
    const bakery = rulesList.find((r: { keyword: string }) => r.keyword === 'boulangerie')!;
    expect(amazon.splits).toHaveLength(2);
    expect(bakery.splits).toHaveLength(0);
  });

  it('PUT replaces the splits set atomically', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/rules', headers: { cookie },
      payload: {
        categoryId: primaryCategoryId, keyword: 'amazon',
        splits: [
          { categoryId: splitCategoryA, percent: 70 },
          { categoryId: splitCategoryB, percent: 30 },
        ],
      },
    });
    const id = created.json().rule.id;
    const put = await app.inject({
      method: 'PUT', url: `/api/rules/${id}`, headers: { cookie },
      payload: {
        splits: [
          { categoryId: splitCategoryA, percent: 40 },
          { categoryId: splitCategoryB, percent: 60 },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().rule.splits).toEqual([
      { categoryId: splitCategoryA, percent: 40 },
      { categoryId: splitCategoryB, percent: 60 },
    ]);
  });

  it('PUT splits:null reverts the rule to single-category mode', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/rules', headers: { cookie },
      payload: {
        categoryId: primaryCategoryId, keyword: 'amazon',
        splits: [
          { categoryId: splitCategoryA, percent: 70 },
          { categoryId: splitCategoryB, percent: 30 },
        ],
      },
    });
    const id = created.json().rule.id;
    const put = await app.inject({
      method: 'PUT', url: `/api/rules/${id}`, headers: { cookie },
      payload: { splits: null },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().rule.splits).toEqual([]);
  });

  it('PUT with only splits leaves other rule fields unchanged', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/rules', headers: { cookie },
      payload: {
        categoryId: primaryCategoryId, keyword: 'amazon', priority: 42,
      },
    });
    const id = created.json().rule.id;
    const put = await app.inject({
      method: 'PUT', url: `/api/rules/${id}`, headers: { cookie },
      payload: {
        splits: [
          { categoryId: splitCategoryA, percent: 70 },
          { categoryId: splitCategoryB, percent: 30 },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    const rule = put.json().rule;
    expect(rule.priority).toBe(42);
    expect(rule.keyword).toBe('amazon');
  });
});
