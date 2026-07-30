// requires Postgres or PGlite + onboarding setup — run with RUN_DB_TESTS=1
// (optionally DB_DRIVER=pglite for the embedded driver).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { __setEbFetchForTests } from '../src/services/enable-banking/client.js';

const RUN = !!process.env.RUN_DB_TESTS;

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim();
const APP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const SESSION_FIXTURE = {
  session_id: 'sess-123',
  accounts: [
    { uid: 'uid-1', account_id: { iban: 'FR7612345' }, name: 'Compte Courant', currency: 'EUR' },
    { uid: 'uid-2', account_id: { iban: 'FR7699999' }, name: 'Livret A', currency: 'EUR' },
  ],
  aspsp: { name: 'CIC', country: 'FR' },
  access: { valid_until: '2027-01-26T00:00:00.000Z' },
};

let app: FastifyInstance;
let cookieA: string;
let cookieB: string;
let userAId: number;
let accountAId: number;
let accountBId: number;
let connectionId: number;

let calls: { url: string; init?: RequestInit }[] = [];

// Routing fake: matches the first entry whose substring appears in the URL.
function ebRoutes(routes: [string, number, unknown][]): void {
  calls = [];
  __setEbFetchForTests((async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const hit = routes.find(([needle]) => String(url).includes(needle));
    if (!hit) throw new Error(`no fake route for ${String(url)}`);
    return new Response(JSON.stringify(hit[2]), {
      status: hit[1],
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch);
}

describe.skipIf(!RUN)('/api/bank-sync connections', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    const users: Array<[string, string]> = [
      ['conn-user-a', 'bank-sync-1234'],
      ['conn-user-b', 'bank-sync-5678'],
    ];
    for (const [user, pass] of users) {
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
      if (user === 'conn-user-a') {
        cookieA = cookie;
        userAId = created.json().user.id;
      } else {
        cookieB = cookie;
      }
    }

    for (const [cookie, name] of [
      [cookieA, 'CONN-A'],
      [cookieB, 'CONN-B'],
    ] as const) {
      const acc = await app.inject({
        method: 'POST',
        url: '/api/accounts',
        headers: { cookie },
        payload: { name, type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
      });
      if (name === 'CONN-A') accountAId = acc.json().account.id;
      else accountBId = acc.json().account.id;
    }

    const { setCredentials } = await import('../src/domain/bank-sync/store.js');
    await setCredentials(userAId, APP_ID, PEM);
  });

  afterAll(async () => {
    __setEbFetchForTests(null);
    await app.close();
  });

  it('refuses the consent flow when credentials are not configured (409)', async () => {
    for (const [method, url, payload] of [
      ['GET', '/api/bank-sync/aspsps', undefined],
      ['POST', '/api/bank-sync/connect', { aspspName: 'CIC' }],
      ['POST', '/api/bank-sync/sessions', { code: 'x' }],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        headers: { cookie: cookieB },
        ...(payload ? { payload } : {}),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('bank sync not configured');
    }
  });

  it('proxies the FR bank list', async () => {
    ebRoutes([[
      '/aspsps', 200,
      { aspsps: [{ name: 'CIC', country: 'FR', logo: 'https://logo/cic.png' }, { name: 'Boursorama', country: 'FR' }] },
    ]]);
    const res = await app.inject({
      method: 'GET',
      url: '/api/bank-sync/aspsps',
      headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().aspsps).toEqual([
      { name: 'CIC', country: 'FR', logo: 'https://logo/cic.png' },
      { name: 'Boursorama', country: 'FR', logo: null },
    ]);
    expect(calls[0]!.url).toContain('country=FR');
  });

  it('starts an authorization and returns the bank consent URL', async () => {
    ebRoutes([['/auth', 200, { url: 'https://bank.example/consent?x=1' }]]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/bank-sync/connect',
      headers: { cookie: cookieA },
      payload: { aspspName: 'CIC' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://bank.example/consent?x=1' });

    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body.aspsp).toEqual({ name: 'CIC', country: 'FR' });
    expect(body.redirect_url).toMatch(/\/bank-sync\/callback$/);
    expect(body.state).toMatch(/^[0-9a-f]{32}$/);
    expect(body.psu_type).toBe('personal');
  });

  it('requests the https twin of a plain-http LAN origin as redirect_url', async () => {
    // Enable Banking's Control Panel refuses whitelisting http:// (except
    // localhost), so the whitelist necessarily holds the https twin and the
    // requested redirect_url must byte-match it.
    ebRoutes([['/auth', 200, { url: 'https://bank.example/consent' }]]);
    await app.inject({
      method: 'POST',
      url: '/api/bank-sync/connect',
      headers: { cookie: cookieA, origin: 'http://192.168.1.91:8000' },
      payload: { aspspName: 'CIC' },
    });
    expect(JSON.parse(String(calls[0]!.init?.body)).redirect_url).toBe(
      'https://192.168.1.91:8000/bank-sync/callback',
    );

    // localhost keeps plain http — panels accept it and the redirect works.
    ebRoutes([['/auth', 200, { url: 'https://bank.example/consent' }]]);
    await app.inject({
      method: 'POST',
      url: '/api/bank-sync/connect',
      headers: { cookie: cookieA, origin: 'http://localhost:8000' },
      payload: { aspspName: 'CIC' },
    });
    expect(JSON.parse(String(calls[0]!.init?.body)).redirect_url).toBe(
      'http://localhost:8000/bank-sync/callback',
    );
  });

  it('exchanges the code, persists the connection and returns its accounts', async () => {
    ebRoutes([['/sessions', 200, SESSION_FIXTURE]]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/bank-sync/sessions',
      headers: { cookie: cookieA },
      payload: { code: 'auth-code-1' },
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    connectionId = json.connection.id;
    expect(json.connection).toMatchObject({
      aspspName: 'CIC',
      aspspCountry: 'FR',
      validUntil: '2027-01-26',
      status: 'active',
    });
    expect(json.accounts).toEqual([
      { uid: 'uid-1', iban: 'FR7612345', name: 'Compte Courant', currency: 'EUR' },
      { uid: 'uid-2', iban: 'FR7699999', name: 'Livret A', currency: 'EUR' },
    ]);
  });

  it('surfaces an Enable Banking failure as 502 with the upstream status', async () => {
    ebRoutes([['/sessions', 400, { detail: 'invalid code' }]]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/bank-sync/sessions',
      headers: { cookie: cookieA },
      payload: { code: 'bad-code' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'enable banking request failed', upstreamStatus: 400 });
  });

  it('lists connections with their (still unmapped) accounts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/bank-sync/connections',
      headers: { cookie: cookieA },
    });
    const { connections } = res.json();
    expect(connections).toHaveLength(1);
    expect(connections[0].accounts).toHaveLength(2);
    expect(connections[0].accounts.every((a: { accountId: number | null }) => a.accountId === null)).toBe(true);
  });

  it('does not leak connections across users', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/bank-sync/connections',
      headers: { cookie: cookieB },
    });
    expect(res.json().connections).toEqual([]);
  });

  it('saves account mappings', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/bank-sync/connections/${connectionId}/mappings`,
      headers: { cookie: cookieA },
      payload: { mappings: [{ bankAccountUid: 'uid-1', accountId: accountAId }] },
    });
    expect(res.statusCode).toBe(200);
    const mapped = res.json().connection.accounts.find(
      (a: { bankAccountUid: string }) => a.bankAccountUid === 'uid-1',
    );
    expect(mapped.accountId).toBe(accountAId);
  });

  it("rejects mapping to another user's account (400)", async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/bank-sync/connections/${connectionId}/mappings`,
      headers: { cookie: cookieA },
      payload: { mappings: [{ bankAccountUid: 'uid-2', accountId: accountBId }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('unknown account');
  });

  it("404s another user's connection", async () => {
    for (const [method, url, payload] of [
      ['PUT', `/api/bank-sync/connections/${connectionId}/mappings`, { mappings: [{ bankAccountUid: 'uid-1', accountId: null }] }],
      ['DELETE', `/api/bank-sync/connections/${connectionId}`, undefined],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        headers: { cookie: cookieB },
        ...(payload ? { payload } : {}),
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('unmaps with accountId null', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/bank-sync/connections/${connectionId}/mappings`,
      headers: { cookie: cookieA },
      payload: { mappings: [{ bankAccountUid: 'uid-1', accountId: null }] },
    });
    expect(res.statusCode).toBe(200);
    const row = res.json().connection.accounts.find(
      (a: { bankAccountUid: string }) => a.bankAccountUid === 'uid-1',
    );
    expect(row.accountId).toBeNull();
  });

  it('deletes a connection (cascading its account rows)', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/bank-sync/connections/${connectionId}`,
      headers: { cookie: cookieA },
    });
    expect(del.statusCode).toBe(200);
    const res = await app.inject({
      method: 'GET',
      url: '/api/bank-sync/connections',
      headers: { cookie: cookieA },
    });
    expect(res.json().connections).toEqual([]);
  });
});
