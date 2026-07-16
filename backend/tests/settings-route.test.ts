// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;

describe.skipIf(!RUN)('/api/settings', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'settings', password: 'settings-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'settings', password: 'settings-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { userSettings } = await import('../src/db/schema.js');
    await db.delete(userSettings);
  });

  it('GET without auth returns 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(401);
  });

  it('GET for a user with no row returns defaults', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toEqual({
      dashboardRange: '3m',
      dashboardChartScope: 'all',
      chartGapThresholdDays: 6,
      duplicateSimilarityThreshold: 0,
    });
  });

  it('PATCH with a partial upserts and returns the merged full object', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { dashboardRange: '12m', chartGapThresholdDays: 10 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toEqual({
      dashboardRange: '12m',
      dashboardChartScope: 'all',
      chartGapThresholdDays: 10,
      duplicateSimilarityThreshold: 0,
    });
  });

  it('two disjoint PATCHes merge (second GET reflects both)', async () => {
    await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { dashboardRange: '6m' },
    });
    await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { duplicateSimilarityThreshold: 42 },
    });
    const get = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(get.json().settings.dashboardRange).toBe('6m');
    expect(get.json().settings.duplicateSimilarityThreshold).toBe(42);
  });

  it('PATCH with an out-of-range value returns 400', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { chartGapThresholdDays: 999 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH with an unknown key returns 400 (strict schema)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { bogus: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH dashboardChartScope pointing to a deleted account sanitises to all on next GET', async () => {
    const tmp = await app.inject({
      method: 'POST', url: '/api/accounts', headers: { cookie },
      payload: { name: 'ToDelete', type: 'current', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    const tmpId = tmp.json().account.id;
    await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { dashboardChartScope: tmpId },
    });
    await app.inject({ method: 'DELETE', url: `/api/accounts/${tmpId}`, headers: { cookie } });
    const get = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(get.json().settings.dashboardChartScope).toBe('all');
  });

  it('PATCH dashboardChartScope pointing to another user\'s account sanitises to all', async () => {
    // Create a second user with their own account.
    // Log the first user out first so the onboarding endpoint stays disabled but
    // /api/auth/login lets us switch — actually onboarding refuses after the first
    // user is created; we side-step by inserting via db directly to keep the test
    // hermetic to route order.
    const { db } = await import('../src/db/client.js');
    const { users, accounts } = await import('../src/db/schema.js');
    const [otherUser] = await db.insert(users).values({
      username: 'other-user-settings',
      passwordHash: 'x',
    }).returning();
    const [otherAcc] = await db.insert(accounts).values({
      userId: otherUser!.id,
      name: 'Other',
      type: 'current',
      currency: 'EUR',
      openingBalance: '0',
      openingDate: '2025-01-01',
    }).returning();
    // Original user PATCHes their scope to the other user's account id.
    await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { dashboardChartScope: otherAcc!.id },
    });
    const get = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(get.json().settings.dashboardChartScope).toBe('all');
    // Cleanup.
    const { eq } = await import('drizzle-orm');
    await db.delete(users).where(eq(users.id, otherUser!.id));
  });

  it('cascades on user deletion', async () => {
    await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { dashboardRange: '6m' },
    });
    const { db } = await import('../src/db/client.js');
    const { users, userSettings } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    // Grab the user's id via the /me route.
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    const uid = me.json().user.id;
    await db.delete(users).where(eq(users.id, uid));
    const rows = await db.select().from(userSettings).where(eq(userSettings.userId, uid));
    expect(rows).toHaveLength(0);
  });

  it('user_settings has a dismissed_tips column defaulting to {}', async () => {
    const { db } = await import('../src/db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users, userSettings } = await import('../src/db/schema.js');

    const [u] = await db.insert(users).values({
      username: 'tips-smoke',
      passwordHash: 'x',
    }).returning();

    await db.insert(userSettings).values({ userId: u.id });
    const rows = await db.select().from(userSettings)
      .where(eq(userSettings.userId, u.id));
    expect(rows[0]?.dismissedTips).toEqual({});

    await db.delete(users).where(eq(users.id, u.id));
  });
});
