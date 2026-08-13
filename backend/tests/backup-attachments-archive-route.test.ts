// requires Postgres or PGlite + onboarding setup — run with RUN_DB_TESTS=1
// (optionally DB_DRIVER=pglite for the embedded driver).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';

const RUN = !!process.env.RUN_DB_TESTS;

// 1×1 red-pixel PNG — real magic bytes so the sniffer accepts it.
const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8//8/AwAI/AL+' +
  'XJTsuwAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_1x1_BASE64, 'base64');
const PASSPHRASE = 'archive-test-passphrase';

async function buildForm(
  filename: string,
  contents: Buffer,
  contentType: string,
  extraFields: Record<string, string> = {},
) {
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
  form.append('file', contents, { filename, contentType });
  return { headers: form.getHeaders(), payload: form.getBuffer() };
}

let app: FastifyInstance;
let cookieA: string;
let cookieB: string;
let userAId: number;
let userBId: number;
let txAId: number;
let tmp: string;

describe.skipIf(!RUN)('/api/backup/{export,import}-attachments', () => {
  beforeAll(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'athena-att-arch-'));
    process.env.DATA_DIR = tmp;

    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    const { db } = await import('../src/db/client.js');
    const { accounts, transactions, users } = await import('../src/db/schema.js');

    for (const [user, pass] of [
      ['att-arch-a', 'att-arch-1234'],
      ['att-arch-b', 'att-arch-5678'],
    ] as const) {
      await app.inject({
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
      const [row] = await db.select().from(users).where(eq(users.username, user));
      const [acc] = await db
        .insert(accounts)
        .values({
          userId: row!.id,
          name: `Arch ${user}`,
          type: 'checking',
          openingDate: '2025-01-01',
        })
        .returning();
      const [tx] = await db
        .insert(transactions)
        .values({
          userId: row!.id,
          accountId: acc!.id,
          date: '2026-01-15',
          amount: '-42.00',
          rawLabel: 'Arch tx',
          normalizedLabel: 'arch tx',
          dedupKey: `${user}-txkey`,
        })
        .returning();
      if (user === 'att-arch-a') {
        cookieA = cookie;
        userAId = row!.id;
        txAId = Number(tx!.id);
      } else {
        cookieB = cookie;
        userBId = row!.id;
      }
    }
  });

  afterAll(async () => {
    const { db } = await import('../src/db/client.js');
    const { accounts, transactions, users, transactionAttachments } = await import(
      '../src/db/schema.js'
    );
    for (const uid of [userAId, userBId]) {
      await db.delete(transactionAttachments).where(eq(transactionAttachments.userId, uid));
      await db.delete(transactions).where(eq(transactions.userId, uid));
      await db.delete(accounts).where(eq(accounts.userId, uid));
      await db.delete(users).where(eq(users.id, uid));
    }
    await app?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  async function uploadOne(cookie: string, txId: number, filename: string) {
    const { headers, payload } = await buildForm(filename, PNG_BYTES, 'image/png');
    const res = await app.inject({
      method: 'POST',
      url: `/api/transactions/${txId}/attachments`,
      headers: { cookie, ...headers },
      payload,
    });
    expect(res.statusCode).toBe(201);
    return res.json().attachment as { id: number; filename: string };
  }

  it('rejects export without a passphrase', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/export-attachments',
      headers: { cookie: cookieA, 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('round-trips: export, wipe, import restores DB rows and disk files', async () => {
    // Fresh state for this test.
    const { db } = await import('../src/db/client.js');
    const { transactionAttachments } = await import('../src/db/schema.js');
    await db.delete(transactionAttachments).where(eq(transactionAttachments.userId, userAId));

    await uploadOne(cookieA, txAId, 'r1.png');
    await uploadOne(cookieA, txAId, 'r2.png');

    // Export.
    const exp = await app.inject({
      method: 'POST',
      url: '/api/backup/export-attachments',
      headers: { cookie: cookieA, 'content-type': 'application/json' },
      payload: { passphrase: PASSPHRASE },
    });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-type']).toBe('application/octet-stream');
    const archive = Buffer.from(exp.rawPayload);
    expect(archive.length).toBeGreaterThan(0);

    // Wipe both the DB rows and the on-disk files to prove the import is what
    // rebuilt them (not leftover state from the pre-export uploads).
    const rowsBefore = await db
      .select()
      .from(transactionAttachments)
      .where(eq(transactionAttachments.userId, userAId));
    for (const row of rowsBefore) {
      const abs = path.join(tmp, 'attachments', row.storedPath);
      if (existsSync(abs)) await rm(abs);
    }
    await db.delete(transactionAttachments).where(eq(transactionAttachments.userId, userAId));

    // Import.
    const { headers, payload } = await buildForm(
      'archive.bin',
      archive,
      'application/octet-stream',
      { passphrase: PASSPHRASE },
    );
    const imp = await app.inject({
      method: 'POST',
      url: '/api/backup/import-attachments',
      headers: { cookie: cookieA, ...headers },
      payload,
    });
    expect(imp.statusCode).toBe(200);
    const summary = imp.json() as { restored: number; skipped: number };
    expect(summary.restored).toBe(2);
    expect(summary.skipped).toBe(0);

    const rowsAfter = await db
      .select()
      .from(transactionAttachments)
      .where(eq(transactionAttachments.userId, userAId));
    expect(rowsAfter).toHaveLength(2);
    expect(rowsAfter.map((r) => r.filename).sort()).toEqual(['r1.png', 'r2.png']);
    for (const row of rowsAfter) {
      const abs = path.join(tmp, 'attachments', row.storedPath);
      expect(existsSync(abs)).toBe(true);
    }
  });

  it('rejects import with the wrong passphrase (no data is destroyed)', async () => {
    const { db } = await import('../src/db/client.js');
    const { transactionAttachments } = await import('../src/db/schema.js');
    await db.delete(transactionAttachments).where(eq(transactionAttachments.userId, userAId));
    await uploadOne(cookieA, txAId, 'keep.png');

    const exp = await app.inject({
      method: 'POST',
      url: '/api/backup/export-attachments',
      headers: { cookie: cookieA, 'content-type': 'application/json' },
      payload: { passphrase: PASSPHRASE },
    });
    const archive = Buffer.from(exp.rawPayload);

    const { headers, payload } = await buildForm(
      'archive.bin',
      archive,
      'application/octet-stream',
      { passphrase: 'wrong-guess-1234' },
    );
    const imp = await app.inject({
      method: 'POST',
      url: '/api/backup/import-attachments',
      headers: { cookie: cookieA, ...headers },
      payload,
    });
    expect(imp.statusCode).toBe(400);
    expect(imp.json().error).toMatch(/wrong passphrase|corrupted/i);

    // The kept attachment is still there — a bad-passphrase attempt must
    // never take user data with it.
    const rows = await db
      .select()
      .from(transactionAttachments)
      .where(eq(transactionAttachments.userId, userAId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.filename).toBe('keep.png');
  });

  it('skips archive entries whose (account, dedupKey) does not resolve for the caller', async () => {
    // Export from user A, then try to import into user B (whose transaction
    // has a different dedupKey). Every entry should be skipped, not applied.
    const { db } = await import('../src/db/client.js');
    const { transactionAttachments } = await import('../src/db/schema.js');
    await db.delete(transactionAttachments).where(eq(transactionAttachments.userId, userAId));
    await uploadOne(cookieA, txAId, 'notyours.png');

    const exp = await app.inject({
      method: 'POST',
      url: '/api/backup/export-attachments',
      headers: { cookie: cookieA, 'content-type': 'application/json' },
      payload: { passphrase: PASSPHRASE },
    });
    const archive = Buffer.from(exp.rawPayload);

    const { headers, payload } = await buildForm(
      'archive.bin',
      archive,
      'application/octet-stream',
      { passphrase: PASSPHRASE },
    );
    const imp = await app.inject({
      method: 'POST',
      url: '/api/backup/import-attachments',
      headers: { cookie: cookieB, ...headers },
      payload,
    });
    expect(imp.statusCode).toBe(200);
    const summary = imp.json() as { restored: number; skipped: number };
    expect(summary.restored).toBe(0);
    expect(summary.skipped).toBe(1);

    const rowsB = await db
      .select()
      .from(transactionAttachments)
      .where(eq(transactionAttachments.userId, userBId));
    expect(rowsB).toHaveLength(0);
  });
});
