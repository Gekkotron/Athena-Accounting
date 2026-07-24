// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let categoryId: number;

describe.skipIf(!RUN)('/api/rules', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'rules-user', password: 'rules-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'rules-user', password: 'rules-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const cat = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie },
      payload: { name: 'RulesCourses', kind: 'expense' },
    });
    categoryId = cat.json().category.id;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { rules } = await import('../src/db/schema.js');
    await db.delete(rules);
  });

  it('creates a rule with defaults for signConstraint/matchMode/priority/enabled', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/rules',
      headers: { cookie },
      payload: { categoryId, keyword: 'carrefour' },
    });
    expect(res.statusCode).toBe(201);
    const r = res.json().rule;
    expect(r.keyword).toBe('carrefour');
    expect(r.signConstraint).toBe('any');
    expect(r.matchMode).toBe('word');
    expect(r.priority).toBe(0);
    expect(r.enabled).toBe(true);
  });

  it('rejects an unknown categoryId with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/rules',
      headers: { cookie },
      payload: { categoryId: 999999, keyword: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unknown|categoryId/i);
  });

  it('rejects invalid input with 400 (empty keyword)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/rules',
      headers: { cookie },
      payload: { categoryId, keyword: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists rules ordered by priority desc', async () => {
    await app.inject({
      method: 'POST', url: '/api/rules',
      headers: { cookie },
      payload: { categoryId, keyword: 'low', priority: 1 },
    });
    await app.inject({
      method: 'POST', url: '/api/rules',
      headers: { cookie },
      payload: { categoryId, keyword: 'high', priority: 99 },
    });
    const res = await app.inject({
      method: 'GET', url: '/api/rules', headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json().rules;
    expect(list[0].keyword).toBe('high');
    expect(list[1].keyword).toBe('low');
  });

  it('updates a rule via PUT', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/rules',
      headers: { cookie },
      payload: { categoryId, keyword: 'orig' },
    });
    const id = created.json().rule.id;

    const put = await app.inject({
      method: 'PUT', url: `/api/rules/${id}`,
      headers: { cookie },
      payload: { keyword: 'renamed', enabled: false },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().rule.keyword).toBe('renamed');
    expect(put.json().rule.enabled).toBe(false);
  });

  it('PUT rejects empty patch with 400', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/rules',
      headers: { cookie },
      payload: { categoryId, keyword: 'k' },
    });
    const id = created.json().rule.id;
    const put = await app.inject({
      method: 'PUT', url: `/api/rules/${id}`,
      headers: { cookie }, payload: {},
    });
    expect(put.statusCode).toBe(400);
  });

  it('PUT returns 404 for missing id', async () => {
    const put = await app.inject({
      method: 'PUT', url: '/api/rules/999999',
      headers: { cookie }, payload: { keyword: 'x' },
    });
    expect(put.statusCode).toBe(404);
  });

  it('deletes a rule', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/rules',
      headers: { cookie },
      payload: { categoryId, keyword: 'gone' },
    });
    const id = created.json().rule.id;
    const del = await app.inject({
      method: 'DELETE', url: `/api/rules/${id}`, headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
  });

  it('DELETE returns 404 for missing id', async () => {
    const del = await app.inject({
      method: 'DELETE', url: '/api/rules/999999',
      headers: { cookie },
    });
    expect(del.statusCode).toBe(404);
  });

  it('DELETE returns 400 on non-integer id', async () => {
    const del = await app.inject({
      method: 'DELETE', url: '/api/rules/nope',
      headers: { cookie },
    });
    expect(del.statusCode).toBe(400);
  });

  it('POST /api/recategorize returns a summary object', async () => {
    // Seed a rule + a stray transaction so the engine has something to do.
    await app.inject({
      method: 'POST', url: '/api/rules',
      headers: { cookie },
      payload: { categoryId, keyword: 'recat-target' },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/recategorize',
      headers: { cookie }, payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.total).toBe('number');
    expect(typeof body.recategorized).toBe('number');
    expect(typeof body.preserved).toBe('number');
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rules' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a regex rule with a catastrophic-backtracking pattern with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/rules',
      headers: { cookie },
      payload: { categoryId, keyword: '(a+)+', matchMode: 'regex' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/redos|nested|quantifier/i);
  });

  it('rejects a regex rule with invalid syntax with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/rules',
      headers: { cookie },
      payload: { categoryId, keyword: '(unclosed', matchMode: 'regex' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/invalid regex/i);
  });

  it("does not leak, mutate, or delete another user's rules (cross-user isolation)", async () => {
    const { db } = await import('../src/db/client.js');
    const { users, categories, rules } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');

    // Second user with their own category + rule, inserted directly
    // (onboarding refuses a second user after the first-run account exists).
    const [otherUser] = await db.insert(users).values({
      username: 'other-user-rules', passwordHash: 'x',
    }).returning();
    const [otherCat] = await db.insert(categories).values({
      userId: otherUser!.id, name: 'Autre Rules', kind: 'expense',
    }).returning();
    const [otherRule] = await db.insert(rules).values({
      userId: otherUser!.id, categoryId: otherCat!.id, keyword: 'secret-keyword',
    }).returning();

    // The first user must not see the other user's rule in their list.
    const list = await app.inject({ method: 'GET', url: '/api/rules', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().rules.some((r: { id: number }) => r.id === otherRule!.id)).toBe(false);

    // And must not be able to update or delete it — 404, never 200.
    const put = await app.inject({
      method: 'PUT', url: `/api/rules/${otherRule!.id}`,
      headers: { cookie }, payload: { keyword: 'hijacked' },
    });
    expect(put.statusCode).toBe(404);
    const del = await app.inject({
      method: 'DELETE', url: `/api/rules/${otherRule!.id}`, headers: { cookie },
    });
    expect(del.statusCode).toBe(404);

    // The other user's rule is untouched.
    const [still] = await db.select().from(rules).where(eq(rules.id, otherRule!.id));
    expect(still?.keyword).toBe('secret-keyword');

    // Cleanup — cascades to the category + rule.
    await db.delete(users).where(eq(users.id, otherUser!.id));
  });

  describe('POST /api/rules/preview', () => {
    let accountId: number;

    beforeAll(async () => {
      const acct = await app.inject({
        method: 'POST', url: '/api/accounts',
        headers: { cookie },
        payload: { name: 'Preview acct', type: 'checking', openingDate: '2026-01-01' },
      });
      accountId = acct.json().account.id;

      const fixtures = [
        { date: '2026-06-15', amount: '-42.30', rawLabel: 'CB CARREFOUR PARIS' },
        { date: '2026-06-16', amount: '-12.00', rawLabel: 'CB CARREFOUR CITY' },
        { date: '2026-06-17', amount: '2500.00', rawLabel: 'VIR SALAIRE ACME' },
        { date: '2026-06-18', amount: '-9.99', rawLabel: 'PAYWEB NETFLIX' },
      ];
      for (const payload of fixtures) {
        const res = await app.inject({
          method: 'POST', url: '/api/transactions',
          headers: { cookie }, payload: { accountId, ...payload },
        });
        if (res.statusCode !== 201) throw new Error(`fixture tx failed: ${res.body}`);
      }
    });

    it('matches word-mode keywords against past transactions, newest first', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/rules/preview',
        headers: { cookie },
        payload: { keyword: 'carrefour' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalCount).toBe(2);
      expect(body.matches.map((m: { rawLabel: string }) => m.rawLabel))
        .toEqual(['CB CARREFOUR CITY', 'CB CARREFOUR PARIS']);
      expect(body.matches[0]).toMatchObject({
        date: '2026-06-16', amount: '-12.00', accountId,
      });
    });

    it('applies the signConstraint filter', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/rules/preview',
        headers: { cookie },
        payload: { keyword: 'carrefour', signConstraint: 'positive' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().totalCount).toBe(0);
    });

    it('supports substring and regex match modes', async () => {
      const sub = await app.inject({
        method: 'POST', url: '/api/rules/preview',
        headers: { cookie },
        payload: { keyword: 'arrefou', matchMode: 'substring' },
      });
      expect(sub.statusCode).toBe(200);
      expect(sub.json().totalCount).toBe(2);

      const re = await app.inject({
        method: 'POST', url: '/api/rules/preview',
        headers: { cookie },
        payload: { keyword: 'net(flix)?', matchMode: 'regex' },
      });
      expect(re.statusCode).toBe(200);
      expect(re.json().totalCount).toBe(1);
      expect(re.json().matches[0].rawLabel).toBe('PAYWEB NETFLIX');
    });

    it('rejects invalid or dangerous regex patterns with 400 without running them', async () => {
      const invalid = await app.inject({
        method: 'POST', url: '/api/rules/preview',
        headers: { cookie },
        payload: { keyword: '(unclosed', matchMode: 'regex' },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error).toMatch(/invalid regex/i);

      const redos = await app.inject({
        method: 'POST', url: '/api/rules/preview',
        headers: { cookie },
        payload: { keyword: '(a+)+b', matchMode: 'regex' },
      });
      expect(redos.statusCode).toBe(400);
      expect(redos.json().error).toMatch(/redos/i);
    });

    it("never previews against another user's transactions", async () => {
      const { db } = await import('../src/db/client.js');
      const { users, accounts, transactions } = await import('../src/db/schema.js');
      const { eq } = await import('drizzle-orm');

      const [otherUser] = await db.insert(users).values({
        username: 'other-user-preview', passwordHash: 'x',
      }).returning();
      const [otherAcct] = await db.insert(accounts).values({
        userId: otherUser!.id, name: 'Autre compte', type: 'checking',
        openingDate: '2026-01-01',
      }).returning();
      await db.insert(transactions).values({
        userId: otherUser!.id, accountId: otherAcct!.id,
        date: '2026-06-20', amount: '-33.00',
        rawLabel: 'CB CARREFOUR AUTRE', normalizedLabel: 'carrefour autre',
        dedupKey: 'preview-other-user-1',
      });

      const res = await app.inject({
        method: 'POST', url: '/api/rules/preview',
        headers: { cookie },
        payload: { keyword: 'carrefour' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalCount).toBe(2);
      for (const m of body.matches) expect(m.accountId).toBe(accountId);

      await db.delete(users).where(eq(users.id, otherUser!.id));
    });
  });
});
