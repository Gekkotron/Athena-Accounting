// requires Postgres or PGlite + onboarding setup — run with RUN_DB_TESTS=1
// (optionally DB_DRIVER=pglite for the embedded driver).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { __setEbFetchForTests } from '../src/services/enable-banking/client.js';

const RUN = !!process.env.RUN_DB_TESTS;

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim();
const APP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const TRANSACTIONS_FIXTURE = {
  transactions: [
    {
      entry_reference: 'REF-1',
      transaction_amount: { currency: 'EUR', amount: '25.30' },
      credit_debit_indicator: 'DBIT',
      status: 'BOOK',
      booking_date: '2026-07-10',
      remittance_information: ['CARTE 09/07 CARREFOUR'],
    },
    {
      entry_reference: 'REF-2',
      transaction_amount: { currency: 'EUR', amount: '1800.00' },
      credit_debit_indicator: 'CRDT',
      status: 'BOOK',
      booking_date: '2026-07-01',
      debtor: { name: 'EMPLOYEUR SA' },
    },
    {
      entry_reference: 'REF-3',
      transaction_amount: { currency: 'EUR', amount: '9.99' },
      credit_debit_indicator: 'DBIT',
      status: 'PEND',
      booking_date: '2026-07-11',
    },
  ],
  continuation_key: null,
};

let app: FastifyInstance;
let cookie: string;
let uid: number;
let accountId: number;
let connectionId: number;
let expiredConnectionId: number;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let schema: any;

let calls: { url: string }[] = [];

function ebTransactionsRespond(status: number, body: unknown): void {
  calls = [];
  __setEbFetchForTests((async (url: unknown) => {
    calls.push({ url: String(url) });
    if (!String(url).includes('/transactions')) throw new Error(`unexpected EB call: ${String(url)}`);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch);
}

describe.skipIf(!RUN)('/api/bank-sync/sync', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    ({ db } = await import('../src/db/client.js'));
    schema = await import('../src/db/schema.js');

    const created = await app.inject({
      method: 'POST',
      url: '/api/onboarding/create',
      payload: { username: 'sync-user', password: 'bank-sync-1234' },
    });
    uid = created.json().user.id;
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'sync-user', password: 'bank-sync-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const acc = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'SYNC-A', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    accountId = acc.json().account.id;

    const { setCredentials } = await import('../src/domain/bank-sync/store.js');
    await setCredentials(uid, APP_ID, PEM);

    // Active connection: one mapped + one unmapped account.
    const [conn] = await db
      .insert(schema.bankConnections)
      .values({
        userId: uid,
        sessionId: 'sess-ok',
        aspspName: 'CIC',
        validUntil: '2027-01-01',
      })
      .returning();
    connectionId = conn.id;
    await db.insert(schema.bankConnectionAccounts).values([
      { connectionId, bankAccountUid: 'uid-mapped', iban: 'FR761234', accountId },
      { connectionId, bankAccountUid: 'uid-unmapped', iban: 'FR769999' },
    ]);

    // Second connection whose consent has already lapsed.
    const [expired] = await db
      .insert(schema.bankConnections)
      .values({
        userId: uid,
        sessionId: 'sess-expired',
        aspspName: 'Boursorama',
        validUntil: '2026-01-01',
      })
      .returning();
    expiredConnectionId = expired.id;
  });

  afterAll(async () => {
    __setEbFetchForTests(null);
    // User-scoped: the CI database is shared across suites.
    await db.delete(schema.bankConnections).where(eq(schema.bankConnections.userId, uid));
    await db.delete(schema.bankSyncCredentials).where(eq(schema.bankSyncCredentials.userId, uid));
    await app.close();
  });

  it('imports booked transactions through the normal pipeline and skips unmapped accounts', async () => {
    ebTransactionsRespond(200, TRANSACTIONS_FIXTURE);
    const res = await app.inject({
      method: 'POST',
      url: '/api/bank-sync/sync',
      headers: { cookie },
      payload: { connectionId },
    });
    expect(res.statusCode).toBe(200);
    const [result] = res.json().results;
    expect(result.status).toBe('ok');
    expect(result.accounts).toEqual([
      { bankAccountUid: 'uid-mapped', accountId, imported: 2, dedupSkipped: 0, dedupSkippedRows: [], skipped: null },
      { bankAccountUid: 'uid-unmapped', accountId: null, imported: 0, dedupSkipped: 0, dedupSkippedRows: [], skipped: 'unmapped' },
    ]);

    // First sync fetches the full consent history (no date_from).
    expect(calls[0]!.url).not.toContain('date_from');

    // The rows landed as real transactions with normalized signs and labels.
    const list = await app.inject({
      method: 'GET',
      url: `/api/transactions?accountId=${accountId}`,
      headers: { cookie },
    });
    const items = list.json().transactions;
    expect(items).toHaveLength(2);
    const labels = items.map((t: { rawLabel: string }) => t.rawLabel).sort();
    expect(labels).toEqual(['CARTE 09/07 CARREFOUR', 'EMPLOYEUR SA']);
    const amounts = items.map((t: { amount: string }) => t.amount).sort();
    expect(amounts).toEqual(['-25.30', '1800.00']);
  });

  it('records a bank-sync audit row in file_imports', async () => {
    const rows = await db.select().from(schema.fileImports).where(eq(schema.fileImports.userId, uid));
    const bankSyncRows = rows.filter((r: { format: string }) => r.format === 'bank-sync');
    expect(bankSyncRows).toHaveLength(1);
    expect(bankSyncRows[0].filename).toContain('CIC');
    expect(bankSyncRows[0].insertedCount).toBe(2);
  });

  it('is idempotent — the same payload twice imports zero new rows', async () => {
    ebTransactionsRespond(200, TRANSACTIONS_FIXTURE);
    const res = await app.inject({
      method: 'POST',
      url: '/api/bank-sync/sync',
      headers: { cookie },
      payload: { connectionId },
    });
    const [result] = res.json().results;
    expect(result.accounts[0]).toMatchObject({ imported: 0, dedupSkipped: 2 });
    // The skipped rows come back so the UI can show WHAT was deduplicated.
    expect(result.accounts[0].dedupSkippedRows).toEqual([
      { date: '2026-07-10', amount: '-25.30', rawLabel: 'CARTE 09/07 CARREFOUR' },
      { date: '2026-07-01', amount: '1800.00', rawLabel: 'EMPLOYEUR SA' },
    ]);

    // Second sync bounds the window to lastSyncedAt minus the overlap.
    expect(calls[0]!.url).toContain('date_from');
  });

  it('marks an expired consent needs_reconnect without calling the bank', async () => {
    ebTransactionsRespond(200, TRANSACTIONS_FIXTURE);
    const res = await app.inject({
      method: 'POST',
      url: '/api/bank-sync/sync',
      headers: { cookie },
      payload: { connectionId: expiredConnectionId },
    });
    expect(res.statusCode).toBe(200);
    const [result] = res.json().results;
    expect(result.status).toBe('needs_reconnect');
    expect(calls).toHaveLength(0);

    const [row] = await db
      .select()
      .from(schema.bankConnections)
      .where((await import('drizzle-orm')).eq(schema.bankConnections.id, expiredConnectionId));
    expect(row.status).toBe('needs_reconnect');
  });

  it('flips the connection to needs_reconnect on an Enable Banking 401 and still returns 200', async () => {
    ebTransactionsRespond(401, { detail: 'session closed' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/bank-sync/sync',
      headers: { cookie },
      payload: { connectionId },
    });
    expect(res.statusCode).toBe(200);
    const [result] = res.json().results;
    expect(result.status).toBe('needs_reconnect');

    const [row] = await db
      .select()
      .from(schema.bankConnections)
      .where((await import('drizzle-orm')).eq(schema.bankConnections.id, connectionId));
    expect(row.status).toBe('needs_reconnect');
  });

  it('never retries a needs_reconnect connection against the bank', async () => {
    ebTransactionsRespond(200, TRANSACTIONS_FIXTURE);
    const res = await app.inject({
      method: 'POST',
      url: '/api/bank-sync/sync',
      headers: { cookie },
      payload: { connectionId },
    });
    const [result] = res.json().results;
    expect(result.status).toBe('needs_reconnect');
    expect(calls).toHaveLength(0);
  });

  it('syncs all connections when no connectionId is given', async () => {
    ebTransactionsRespond(200, TRANSACTIONS_FIXTURE);
    const res = await app.inject({
      method: 'POST',
      url: '/api/bank-sync/sync',
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toHaveLength(2);
  });

  it('starts a first sync AFTER the newest existing transaction (no cross-source duplicates)', async () => {
    // Fresh account with file-era history: one existing row dated 2026-07-05.
    const acc = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'SYNC-B', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    const accountBId = acc.json().account.id;
    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { cookie },
      payload: { accountId: accountBId, date: '2026-07-05', amount: '-10.00', rawLabel: 'OLD FILE ROW' },
    });

    const [conn] = await db
      .insert(schema.bankConnections)
      .values({ userId: uid, sessionId: 'sess-b', aspspName: 'CIC', validUntil: '2027-01-01' })
      .returning();
    await db.insert(schema.bankConnectionAccounts).values({
      connectionId: conn.id,
      bankAccountUid: 'uid-b',
      accountId: accountBId,
    });

    ebTransactionsRespond(200, { transactions: [], continuation_key: null });
    const res = await app.inject({
      method: 'POST',
      url: '/api/bank-sync/sync',
      headers: { cookie },
      payload: { connectionId: conn.id },
    });
    expect(res.statusCode).toBe(200);
    expect(calls[0]!.url).toContain('date_from=2026-07-06');
  });

  it('deleting a bank-sync import batch resets the sync baseline', async () => {
    const imports = await db.select().from(schema.fileImports).where(eq(schema.fileImports.userId, uid));
    const batch = imports.find((r: { format: string }) => r.format === 'bank-sync');
    expect(batch).toBeTruthy();

    // The mapped row got a lastSyncedAt from the earlier successful sync.
    const [before] = await db
      .select()
      .from(schema.bankConnectionAccounts)
      .where(eq(schema.bankConnectionAccounts.bankAccountUid, 'uid-mapped'));
    expect(before.lastSyncedAt).not.toBeNull();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/imports/${batch.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().deleted.transactions).toBeGreaterThan(0);

    const [after] = await db
      .select()
      .from(schema.bankConnectionAccounts)
      .where(eq(schema.bankConnectionAccounts.bankAccountUid, 'uid-mapped'));
    expect(after.lastSyncedAt).toBeNull();
  });
});
