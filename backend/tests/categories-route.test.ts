// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;

describe.skipIf(!RUN)('/api/categories', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'cat-user', password: 'categories-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'cat-user', password: 'categories-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { categories } = await import('../src/db/schema.js');
    const { and, eq } = await import('drizzle-orm');
    // Keep the seeded default (Divers) so onboarding invariants survive.
    await db.delete(categories).where(and(eq(categories.isDefault, false)));
  });

  it('lists categories for the calling user', async () => {
    // Onboarding seeded "Divers" already; assert at least it exists.
    const res = await app.inject({
      method: 'GET', url: '/api/categories', headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const cats = res.json().categories;
    expect(cats.some((c: { name: string }) => c.name === 'Divers')).toBe(true);
  });

  it('creates a new category', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie },
      payload: { name: 'Courses', kind: 'expense', color: '#7dd3c0' },
    });
    expect(res.statusCode).toBe(201);
    const c = res.json().category;
    expect(c.name).toBe('Courses');
    expect(c.kind).toBe('expense');
    expect(c.color).toBe('#7dd3c0');
    expect(c.isDefault).toBe(false);
  });

  it('rejects a duplicate name with 409', async () => {
    await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie },
      payload: { name: 'Salaire', kind: 'income' },
    });
    const dup = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie },
      payload: { name: 'Salaire', kind: 'income' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('accepts the same name under two different parents', async () => {
    const parentA = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Loisirs', kind: 'expense' },
    });
    const parentB = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Voyages', kind: 'expense' },
    });
    expect(parentA.statusCode).toBe(201);
    expect(parentB.statusCode).toBe(201);

    const childA = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Restaurant', kind: 'expense', parentId: parentA.json().category.id },
    });
    const childB = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Restaurant', kind: 'expense', parentId: parentB.json().category.id },
    });
    expect(childA.statusCode).toBe(201);
    expect(childB.statusCode).toBe(201);
  });

  it('still rejects a duplicate name under the same parent', async () => {
    const parent = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Courses', kind: 'expense' },
    });
    await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Alimentation', kind: 'expense', parentId: parent.json().category.id },
    });
    const dup = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Alimentation', kind: 'expense', parentId: parent.json().category.id },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('rejects an invalid kind with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie },
      payload: { name: 'x', kind: 'transfer' }, // dropped by migration 0010
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid color hex with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie },
      payload: { name: 'BadColor', kind: 'expense', color: 'not-hex' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('updates a category name via PUT', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie },
      payload: { name: 'Old', kind: 'expense' },
    });
    const id = created.json().category.id;

    const put = await app.inject({
      method: 'PUT', url: `/api/categories/${id}`,
      headers: { cookie },
      payload: { name: 'New' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().category.name).toBe('New');
  });

  it('PUT rejects an empty patch body with 400', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie },
      payload: { name: 'Any', kind: 'neutral' },
    });
    const id = created.json().category.id;
    const put = await app.inject({
      method: 'PUT', url: `/api/categories/${id}`,
      headers: { cookie }, payload: {},
    });
    expect(put.statusCode).toBe(400);
  });

  it('PUT returns 404 for a missing id', async () => {
    const put = await app.inject({
      method: 'PUT', url: '/api/categories/999999',
      headers: { cookie }, payload: { name: 'x' },
    });
    expect(put.statusCode).toBe(404);
  });

  it('deletes a category', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie },
      payload: { name: 'ToDelete', kind: 'expense' },
    });
    const id = created.json().category.id;
    const del = await app.inject({
      method: 'DELETE', url: `/api/categories/${id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
  });

  it('DELETE refuses the default category with 409', async () => {
    // Find the Divers category.
    const list = await app.inject({
      method: 'GET', url: '/api/categories', headers: { cookie },
    });
    const divers = list.json().categories.find((c: { isDefault: boolean }) => c.isDefault);
    expect(divers).toBeTruthy();

    const del = await app.inject({
      method: 'DELETE', url: `/api/categories/${divers.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(409);
    expect(del.json().error).toMatch(/default/);
  });

  it('DELETE returns 404 for a missing id', async () => {
    const del = await app.inject({
      method: 'DELETE', url: '/api/categories/999999',
      headers: { cookie },
    });
    expect(del.statusCode).toBe(404);
  });

  it('DELETE returns 400 on non-integer id', async () => {
    const del = await app.inject({
      method: 'DELETE', url: '/api/categories/nope',
      headers: { cookie },
    });
    expect(del.statusCode).toBe(400);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/categories' });
    expect(res.statusCode).toBe(401);
  });
});
