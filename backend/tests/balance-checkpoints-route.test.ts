// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let accountAId: number;
let accountBId: number;

describe.skipIf(!RUN)('/api/accounts/:id/balance-checkpoints', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'cpts', password: 'checkpoints-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'cpts', password: 'checkpoints-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const a = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'A', type: 'current', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    accountAId = a.json().account.id;
    const b = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'B', type: 'savings', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    accountBId = b.json().account.id;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { balanceCheckpoints } = await import('../src/db/schema.js');
    await db.delete(balanceCheckpoints);
  });

  it('creates, lists, updates, and deletes a checkpoint', async () => {
    const create = await app.inject({
      method: 'POST', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '2025-12-02', expectedAmount: '2000.00', note: 'relevé nov' },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json().checkpoint;
    expect(created.checkpointDate).toBe('2025-12-02');
    expect(created.expectedAmount).toBe('2000.00');
    expect(created.note).toBe('relevé nov');

    const list = await app.inject({
      method: 'GET', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().checkpoints).toHaveLength(1);

    const put = await app.inject({
      method: 'PUT', url: `/api/accounts/${accountAId}/balance-checkpoints/${created.id}`,
      headers: { cookie }, payload: { expectedAmount: '2050.50', note: '' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().checkpoint.expectedAmount).toBe('2050.50');
    expect(put.json().checkpoint.note).toBeNull();

    const del = await app.inject({
      method: 'DELETE', url: `/api/accounts/${accountAId}/balance-checkpoints/${created.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({
      method: 'GET', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
    });
    expect(after.json().checkpoints).toHaveLength(0);
  });

  it('rejects duplicate (account, date) with 409', async () => {
    await app.inject({
      method: 'POST', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '2025-06-01', expectedAmount: '100.00' },
    });
    const dup = await app.inject({
      method: 'POST', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '2025-06-01', expectedAmount: '200.00' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('checkpoint_exists');
    expect(dup.json().date).toBe('2025-06-01');
  });

  it('rejects invalid input with 400', async () => {
    const bad = await app.inject({
      method: 'POST', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '02-12-2025', expectedAmount: 'not-a-number' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('isolates checkpoints across accounts: PUT with mismatched (id, cpId) is 404', async () => {
    const cp = await app.inject({
      method: 'POST', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '2025-07-01', expectedAmount: '10.00' },
    });
    const cpId = cp.json().checkpoint.id;
    const cross = await app.inject({
      method: 'PUT', url: `/api/accounts/${accountBId}/balance-checkpoints/${cpId}`,
      headers: { cookie }, payload: { expectedAmount: '99.00' },
    });
    expect(cross.statusCode).toBe(404);
  });

  it('cascades on account deletion', async () => {
    const tmpAcc = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'ToDelete', type: 'current', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    const tmpId = tmpAcc.json().account.id;
    await app.inject({
      method: 'POST', url: `/api/accounts/${tmpId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '2025-08-01', expectedAmount: '5.00' },
    });
    await app.inject({ method: 'DELETE', url: `/api/accounts/${tmpId}`, headers: { cookie } });

    const { db } = await import('../src/db/client.js');
    const { balanceCheckpoints } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const rows = await db.select().from(balanceCheckpoints).where(eq(balanceCheckpoints.accountId, tmpId));
    expect(rows).toHaveLength(0);
  });

  it('rejects a note longer than 200 chars with 400', async () => {
    const bad = await app.inject({
      method: 'POST', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '2025-09-01', expectedAmount: '1.00', note: 'x'.repeat(201) },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('trims a whitespace-only note to null', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '2025-10-01', expectedAmount: '1.00', note: '   ' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().checkpoint.note).toBeNull();
  });
});
