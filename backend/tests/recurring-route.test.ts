// requires Postgres or PGlite + onboarding setup — run with RUN_DB_TESTS=1
// (optionally DB_DRIVER=pglite for the embedded driver).
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let accountId: number;
let userId: number;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let schema: any;

describe.skipIf(!RUN)('/api/recurring', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    ({ db } = await import('../src/db/client.js'));
    schema = await import('../src/db/schema.js');

    const onboarded = await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'rec-user', password: 'recurring-1234' },
    });
    userId = onboarded.json().user.id;

    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'rec-user', password: 'recurring-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const acc = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'REC-A', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    accountId = acc.json().account.id;
  });

  afterEach(async () => {
    // Order matters: child rows before parents. Cascades cover most of
    // this but explicit deletes keep other tests independent.
    await db.delete(schema.recurringSeriesTransactions);
    await db.delete(schema.recurringSeries);
    await db.delete(schema.transactions);
  });

  async function seedMonthlySpotify(months: number): Promise<void> {
    const rows = [];
    for (let i = 0; i < months; i++) {
      const m = String(i + 1).padStart(2, '0');
      const date = `2026-${m}-15`;
      rows.push({
        userId,
        accountId,
        date,
        amount: '-9.99',
        rawLabel: 'SPOTIFY',
        normalizedLabel: 'spotify',
        dedupKey: `spotify-${date}`,
      });
    }
    await db.insert(schema.transactions).values(rows);
  }

  it('regenerate + GET produces one detected monthly SPOTIFY series (spec smoke)', async () => {
    await seedMonthlySpotify(6);

    const regen = await app.inject({
      method: 'POST', url: '/api/recurring/regenerate', headers: { cookie },
    });
    expect(regen.statusCode).toBe(200);
    expect(regen.json().ok).toBe(true);

    const list = await app.inject({
      method: 'GET', url: '/api/recurring', headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const series = list.json().recurring;
    expect(series).toHaveLength(1);
    expect(series[0].label).toBe('SPOTIFY');
    expect(series[0].cadenceDays).toBe(30);
    expect(Number(series[0].avgAmount)).toBeCloseTo(-9.99, 2);
    expect(series[0].status).toBe('detected');
    expect(series[0].essentialness).toBeNull();
    expect(series[0].memberCount).toBe(6);
  });

  it('PUT updates status + essentialness', async () => {
    await seedMonthlySpotify(6);
    await app.inject({
      method: 'POST', url: '/api/recurring/regenerate', headers: { cookie },
    });
    const listed = await app.inject({
      method: 'GET', url: '/api/recurring', headers: { cookie },
    });
    const id = listed.json().recurring[0].id;

    const put = await app.inject({
      method: 'PUT', url: `/api/recurring/${id}`, headers: { cookie },
      payload: { status: 'confirmed', essentialness: 'essential' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().recurring.status).toBe('confirmed');
    expect(put.json().recurring.essentialness).toBe('essential');
  });

  it('regenerate preserves confirmed status + essentialness (spec criterion d)', async () => {
    await seedMonthlySpotify(6);
    await app.inject({
      method: 'POST', url: '/api/recurring/regenerate', headers: { cookie },
    });
    const listed = await app.inject({
      method: 'GET', url: '/api/recurring', headers: { cookie },
    });
    const id = listed.json().recurring[0].id;

    await app.inject({
      method: 'PUT', url: `/api/recurring/${id}`, headers: { cookie },
      payload: { status: 'confirmed', essentialness: 'essential' },
    });

    // Add one more month (still fits the same pattern) and regenerate.
    await db.insert(schema.transactions).values([{
      userId, accountId,
      date: '2026-07-15', amount: '-9.99',
      rawLabel: 'SPOTIFY', normalizedLabel: 'spotify',
      dedupKey: 'spotify-2026-07-15',
    }]);
    await app.inject({
      method: 'POST', url: '/api/recurring/regenerate', headers: { cookie },
    });

    const after = await app.inject({
      method: 'GET', url: '/api/recurring', headers: { cookie },
    });
    const rows = after.json().recurring;
    expect(rows).toHaveLength(1);
    // Same row id (updated in place, not deleted+reinserted).
    expect(rows[0].id).toBe(id);
    expect(rows[0].status).toBe('confirmed');
    expect(rows[0].essentialness).toBe('essential');
    // Stats refreshed.
    expect(rows[0].lastSeenAt).toBe('2026-07-15');
    expect(rows[0].memberCount).toBe(7);
  });

  it('PUT rejects an empty patch with 400', async () => {
    await seedMonthlySpotify(6);
    await app.inject({ method: 'POST', url: '/api/recurring/regenerate', headers: { cookie } });
    const id = (await app.inject({ method: 'GET', url: '/api/recurring', headers: { cookie } })).json().recurring[0].id;

    const put = await app.inject({
      method: 'PUT', url: `/api/recurring/${id}`, headers: { cookie }, payload: {},
    });
    expect(put.statusCode).toBe(400);
  });

  it('PUT returns 404 for a missing id', async () => {
    const put = await app.inject({
      method: 'PUT', url: '/api/recurring/999999', headers: { cookie },
      payload: { status: 'confirmed' },
    });
    expect(put.statusCode).toBe(404);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/recurring' });
    expect(res.statusCode).toBe(401);
  });

  it('GET orders by monthly-equivalent amount descending', async () => {
    // Two series: a monthly 100€ and a weekly 30€.
    // Monthly-equivalent: 100 (monthly) vs 30 * 30/7 ≈ 128.6 (weekly).
    // Weekly should come first.
    const rows: Array<Record<string, unknown>> = [];
    // Monthly RENT €100 (6 months).
    for (let i = 0; i < 6; i++) {
      const m = String(i + 1).padStart(2, '0');
      rows.push({
        userId, accountId, date: `2026-${m}-01`, amount: '-100.00',
        rawLabel: 'LOYER', normalizedLabel: 'loyer', dedupKey: `loyer-${m}`,
      });
    }
    // Weekly CAFE €30 (10 weeks starting 2026-01-05).
    for (let i = 0; i < 10; i++) {
      const d = new Date(Date.UTC(2026, 0, 5 + i * 7));
      const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      rows.push({
        userId, accountId, date: iso, amount: '-30.00',
        rawLabel: 'CAFE DU COIN', normalizedLabel: 'cafe du coin', dedupKey: `cafe-${iso}`,
      });
    }
    await db.insert(schema.transactions).values(rows);
    await app.inject({ method: 'POST', url: '/api/recurring/regenerate', headers: { cookie } });

    const list = await app.inject({ method: 'GET', url: '/api/recurring', headers: { cookie } });
    const series = list.json().recurring;
    expect(series).toHaveLength(2);
    expect(series[0].label).toBe('CAFE DU COIN');
    expect(series[1].label).toBe('LOYER');
  });
});
