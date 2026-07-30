// requires Postgres or PGlite + onboarding setup — run with RUN_DB_TESTS=1
// (optionally DB_DRIVER=pglite for the embedded driver).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { __setEbFetchForTests } from '../src/services/enable-banking/client.js';

const RUN = !!process.env.RUN_DB_TESTS;

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const APP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

let app: FastifyInstance;
let cookieA: string;
let cookieB: string;
let userAId: number;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let schema: any;

function ebRespondsWith(status: number, body: unknown): void {
  __setEbFetchForTests((async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch);
}

describe.skipIf(!RUN)('/api/bank-sync credentials', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    ({ db } = await import('../src/db/client.js'));
    schema = await import('../src/db/schema.js');

    for (const [user, pass] of [
      ['bank-user-a', 'bank-sync-1234'],
      ['bank-user-b', 'bank-sync-5678'],
    ] as const) {
      const created = await app.inject({
        method: 'POST',
        url: '/api/onboarding/create',
        payload: { username: user, password: pass },
      });
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: user, password: pass },
      });
      const cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
      if (user === 'bank-user-a') {
        cookieA = cookie;
        userAId = created.json().user.id;
      } else {
        cookieB = cookie;
      }
    }
  });

  afterAll(async () => {
    __setEbFetchForTests(null);
    // Scoped to this suite's user — on CI every suite shares one Postgres,
    // so a global delete would sabotage sibling bank-sync suites mid-run.
    await db.delete(schema.bankSyncCredentials).where(eq(schema.bankSyncCredentials.userId, userAId));
    await app.close();
  });

  it('rejects a syntactically invalid private key with 400 before any network call', async () => {
    __setEbFetchForTests((async () => {
      throw new Error('must not be called');
    }) as typeof fetch);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/bank-sync/credentials',
      headers: { cookie: cookieA },
      payload: { applicationId: APP_ID, privateKey: 'not-a-pem' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid private key');
  });

  it('returns 502 when Enable Banking rejects the credentials', async () => {
    ebRespondsWith(401, { detail: 'invalid signature' });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/bank-sync/credentials',
      headers: { cookie: cookieA },
      payload: { applicationId: APP_ID, privateKey: PEM },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      error: 'enable banking rejected credentials',
      upstreamStatus: 401,
    });
  });

  it('stores validated credentials and reports status without the key', async () => {
    ebRespondsWith(200, { name: 'athena', environment: 'PRODUCTION', active: true });
    const put = await app.inject({
      method: 'PUT',
      url: '/api/bank-sync/credentials',
      headers: { cookie: cookieA },
      payload: { applicationId: APP_ID, privateKey: PEM },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ configured: true, applicationId: APP_ID });
    expect(put.body).not.toContain('PRIVATE KEY');

    const status = await app.inject({
      method: 'GET',
      url: '/api/bank-sync/status',
      headers: { cookie: cookieA },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ configured: true, applicationId: APP_ID });
    expect(status.body).not.toContain('PRIVATE KEY');
  });

  it('persists the key encrypted at rest, and the store round-trips it', async () => {
    // Scoped by user: other suites in the shared CI database also store
    // credentials for their own users.
    const rows = await db
      .select()
      .from(schema.bankSyncCredentials)
      .where(eq(schema.bankSyncCredentials.userId, userAId));
    expect(rows).toHaveLength(1);
    expect(rows[0].privateKeyEncrypted).not.toContain('PRIVATE KEY');
    expect(rows[0].applicationId).toBe(APP_ID);

    const { getCredentials } = await import('../src/domain/bank-sync/store.js');
    const creds = await getCredentials(rows[0].userId);
    // The route trims pasted input, so the stored PEM is the trimmed form.
    expect(creds?.privateKey).toBe(PEM.trim());
  });

  it('scopes status per user — user B sees unconfigured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/bank-sync/status',
      headers: { cookie: cookieB },
    });
    expect(res.json()).toEqual({ configured: false, applicationId: null });
  });

  it('requires auth on every route', async () => {
    for (const [method, url] of [
      ['PUT', '/api/bank-sync/credentials'],
      ['GET', '/api/bank-sync/status'],
      ['DELETE', '/api/bank-sync/credentials'],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
    }
  });

  it('deletes credentials', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/bank-sync/credentials',
      headers: { cookie: cookieA },
    });
    expect(del.statusCode).toBe(200);
    const status = await app.inject({
      method: 'GET',
      url: '/api/bank-sync/status',
      headers: { cookie: cookieA },
    });
    expect(status.json()).toEqual({ configured: false, applicationId: null });
  });
});
