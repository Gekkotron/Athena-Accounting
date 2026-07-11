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

  it('POST rejects a parent that does not exist', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Enfant', kind: 'expense', parentId: 999999 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('parent not found');
  });

  it('POST rejects a grandchild (only 2 levels)', async () => {
    const p = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Racine', kind: 'expense' },
    });
    const c = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Enfant', kind: 'expense', parentId: p.json().category.id },
    });
    const gc = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'PetitEnfant', kind: 'expense', parentId: c.json().category.id },
    });
    expect(gc.statusCode).toBe(400);
    expect(gc.json().error).toBe('only 2 levels supported');
  });

  it('POST coerces child kind to the parent kind', async () => {
    const p = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Depenses', kind: 'expense' },
    });
    const c = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Loyer', kind: 'income', parentId: p.json().category.id },
    });
    expect(c.statusCode).toBe(201);
    expect(c.json().category.kind).toBe('expense');
  });

  it('PUT rejects self-parent', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Solo', kind: 'expense' },
    });
    const id = r.json().category.id;
    const res = await app.inject({
      method: 'PUT', url: `/api/categories/${id}`, headers: { cookie },
      payload: { parentId: id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('cannot self-parent');
  });

  it('PUT rejects nesting a category that has children', async () => {
    const a = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'A', kind: 'expense' },
    });
    const b = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'B', kind: 'expense' },
    });
    await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Bchild', kind: 'expense', parentId: b.json().category.id },
    });
    // now try to nest B under A — but B already has a child.
    const res = await app.inject({
      method: 'PUT', url: `/api/categories/${b.json().category.id}`, headers: { cookie },
      payload: { parentId: a.json().category.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('cannot nest a category that has children');
  });

  it('PUT coerces kind when parentId is set (protects backup restore)', async () => {
    const p = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Salaires', kind: 'income' },
    });
    const orphan = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'PrimeAnnuelle', kind: 'expense' },
    });
    const res = await app.inject({
      method: 'PUT', url: `/api/categories/${orphan.json().category.id}`, headers: { cookie },
      payload: { parentId: p.json().category.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().category.kind).toBe('income');
    expect(res.json().category.parentId).toBe(p.json().category.id);
  });

  it('PUT cascades kind change on a parent to its children', async () => {
    const p = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Groupe', kind: 'expense' },
    });
    const c1 = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Enf1', kind: 'expense', parentId: p.json().category.id },
    });
    const c2 = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Enf2', kind: 'expense', parentId: p.json().category.id },
    });
    const res = await app.inject({
      method: 'PUT', url: `/api/categories/${p.json().category.id}`, headers: { cookie },
      payload: { kind: 'neutral' },
    });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/categories', headers: { cookie } });
    const byId = new Map<number, { kind: string }>(list.json().categories.map((c: { id: number; kind: string }) => [c.id, c]));
    expect(byId.get(c1.json().category.id)!.kind).toBe('neutral');
    expect(byId.get(c2.json().category.id)!.kind).toBe('neutral');
  });

  it('PUT rejects a bare kind change on a child that would deviate', async () => {
    const p = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Depenses2', kind: 'expense' },
    });
    const c = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Loyer2', kind: 'expense', parentId: p.json().category.id },
    });
    const res = await app.inject({
      method: 'PUT', url: `/api/categories/${c.json().category.id}`, headers: { cookie },
      payload: { kind: 'income' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('child kind is inherited from parent');
  });

  it('DELETE parent promotes children to top-level', async () => {
    const p = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'DoomedParent', kind: 'expense' },
    });
    const c = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Survivor', kind: 'expense', parentId: p.json().category.id },
    });
    const del = await app.inject({
      method: 'DELETE', url: `/api/categories/${p.json().category.id}`, headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/categories', headers: { cookie } });
    const survivor = list.json().categories.find((x: { id: number }) => x.id === c.json().category.id);
    expect(survivor.parentId).toBe(null);
  });
});
