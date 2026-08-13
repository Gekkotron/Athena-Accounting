// requires Postgres or PGlite — run with RUN_DB_TESTS=1 (DB_DRIVER=pglite).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';

const RUN = !!process.env.RUN_DB_TESTS;

// 1×1 red-pixel PNG — real magic bytes so the sniffer accepts it.
const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8//8/AwAI/AL+' +
  'XJTsuwAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_1x1_BASE64, 'base64');
const PASSPHRASE = 'runner-attachments-passphrase';

async function buildForm(filename: string, contents: Buffer, contentType: string) {
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', contents, { filename, contentType });
  return { headers: form.getHeaders(), payload: form.getBuffer() };
}

let app: FastifyInstance;
let cookieA: string;
let userAId: number;
let txAId: number;
let tmp: string;
let destDir: string;

describe.skipIf(!RUN)('runBackupNow — attachment archive fingerprint gating', () => {
  beforeAll(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'athena-runatt-'));
    process.env.DATA_DIR = tmp;
    destDir = path.join(tmp, 'dest');
    await (await import('node:fs/promises')).mkdir(destDir, { recursive: true });

    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    const { db } = await import('../src/db/client.js');
    const { accounts, transactions, users } = await import('../src/db/schema.js');

    await app.inject({
      method: 'POST',
      url: '/api/onboarding/create',
      payload: { username: 'runatt-a', password: 'runatt-a-1234' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'runatt-a', password: 'runatt-a-1234' },
    });
    cookieA = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
    const [row] = await db.select().from(users).where(eq(users.username, 'runatt-a'));
    userAId = row!.id;
    const [acc] = await db
      .insert(accounts)
      .values({
        userId: userAId,
        name: 'RunAtt account',
        type: 'checking',
        openingDate: '2025-01-01',
      })
      .returning();
    const [tx] = await db
      .insert(transactions)
      .values({
        userId: userAId,
        accountId: acc!.id,
        date: '2026-01-15',
        amount: '-42.00',
        rawLabel: 'RunAtt tx',
        normalizedLabel: 'runatt tx',
        dedupKey: 'runatt-dedup-1',
      })
      .returning();
    txAId = Number(tx!.id);
  });

  afterAll(async () => {
    const { db } = await import('../src/db/client.js');
    const {
      accounts,
      transactions,
      users,
      transactionAttachments,
      backupDestinations,
    } = await import('../src/db/schema.js');
    await db.delete(transactionAttachments).where(eq(transactionAttachments.userId, userAId));
    await db.delete(backupDestinations).where(eq(backupDestinations.userId, userAId));
    await db.delete(transactions).where(eq(transactions.userId, userAId));
    await db.delete(accounts).where(eq(accounts.userId, userAId));
    await db.delete(users).where(eq(users.id, userAId));
    await app?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  async function uploadAttachment(filename: string) {
    const { headers, payload } = await buildForm(filename, PNG_BYTES, 'image/png');
    const res = await app.inject({
      method: 'POST',
      url: `/api/transactions/${txAId}/attachments`,
      headers: { cookie: cookieA, ...headers },
      payload,
    });
    expect(res.statusCode).toBe(201);
  }

  async function configureDestination() {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/backup/destination',
      headers: { cookie: cookieA },
      payload: {
        kind: 'folder',
        path: destDir,
        keepLast: 5,
        passphrase: PASSPHRASE,
      },
    });
    expect([200, 201, 204]).toContain(res.statusCode);
  }

  async function countByPrefix(prefix: string): Promise<number> {
    const entries = await readdir(destDir);
    return entries.filter((n) => n.startsWith(prefix)).length;
  }

  it('uploads the attachment archive on the first run, skips it when the fingerprint is unchanged, uploads again after a change', async () => {
    await configureDestination();
    await uploadAttachment('r1.png');

    // First run — no prior fingerprint, so BOTH families must land.
    const { runBackupNow } = await import('../src/domain/backup/runner.js');
    const first = await runBackupNow(userAId);
    expect(first.filename).toMatch(/^athena-backup-.*\.enc\.json$/);
    expect(first.attachmentsFilename).toMatch(/^athena-attachments-.*\.bin$/);
    expect(await countByPrefix('athena-backup-')).toBe(1);
    expect(await countByPrefix('athena-attachments-')).toBe(1);

    // Second run, no attachment changes — JSON refreshes, archive does not.
    const second = await runBackupNow(userAId);
    expect(second.attachmentsFilename).toBeUndefined();
    expect(await countByPrefix('athena-backup-')).toBe(2);
    expect(await countByPrefix('athena-attachments-')).toBe(1);

    // Add another attachment, run again — archive re-uploads.
    await uploadAttachment('r2.png');
    const third = await runBackupNow(userAId);
    expect(third.attachmentsFilename).toBeDefined();
    expect(await countByPrefix('athena-attachments-')).toBe(2);
  });

  it('prunes attachment archives independently of JSON dumps (keepLast is per-family)', async () => {
    // Given the previous test uploaded 3 JSON dumps + 2 attachment archives
    // with keepLast=5, none should have been pruned yet — the families' file
    // counts stayed under the cap and did not interfere with each other.
    // Deliberately re-tick many times to overflow the archive keepLast=5:
    // each iteration adds a new attachment (fingerprint shifts), so both
    // families upload every run.
    const before = await countByPrefix('athena-attachments-');
    for (let i = 0; i < 6; i++) {
      await uploadAttachment(`bulk-${i}.png`);
      const { runBackupNow } = await import('../src/domain/backup/runner.js');
      await runBackupNow(userAId);
    }
    // With keepLast=5 the archive family caps at 5, regardless of the JSON
    // family's own retention.
    expect(await countByPrefix('athena-attachments-')).toBe(5);
    // JSON family also caps at 5 (was 3, +6 more = 9 uploads → pruned to 5).
    expect(await countByPrefix('athena-backup-')).toBe(5);
    // Silence the unused warning while keeping `before` documented above.
    expect(before).toBeGreaterThanOrEqual(0);
  });
});
