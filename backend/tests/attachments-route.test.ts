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

// Minimal valid PNG (1×1 red pixel) — small enough to inline but real magic
// bytes so the sniffer accepts it. Base64 lifted from tooling; do not tweak.
const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8//8/AwAI/AL+' +
  'XJTsuwAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_1x1_BASE64, 'base64');

async function buildForm(filename: string, contents: Buffer, contentType: string) {
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', contents, { filename, contentType });
  return { headers: form.getHeaders(), payload: form.getBuffer() };
}

let app: FastifyInstance;
let cookieA: string;
let cookieB: string;
let userAId: number;
let userBId: number;
let txAId: number;
let txBId: number;
let tmp: string;

describe.skipIf(!RUN)('/api/transactions/:id/attachments', () => {
  beforeAll(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'athena-att-'));
    process.env.DATA_DIR = tmp;

    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    const { db } = await import('../src/db/client.js');
    const { accounts, transactions, users } = await import('../src/db/schema.js');

    for (const [user, pass] of [
      ['att-user-a', 'att-user-1234'],
      ['att-user-b', 'att-user-5678'],
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
          name: `Att ${user}`,
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
          rawLabel: 'Test purchase',
          normalizedLabel: 'test purchase',
          dedupKey: `${user}-tx1`,
        })
        .returning();
      if (user === 'att-user-a') {
        cookieA = cookie;
        userAId = row!.id;
        txAId = Number(tx!.id);
      } else {
        cookieB = cookie;
        userBId = row!.id;
        txBId = Number(tx!.id);
      }
    }
  });

  afterAll(async () => {
    const { db } = await import('../src/db/client.js');
    const { accounts, transactions, users, transactionAttachments } = await import(
      '../src/db/schema.js'
    );
    // Scope cleanup to this suite's users so a shared-Postgres CI run
    // doesn't sabotage sibling suites' data.
    for (const uid of [userAId, userBId]) {
      await db.delete(transactionAttachments).where(eq(transactionAttachments.userId, uid));
      await db.delete(transactions).where(eq(transactions.userId, uid));
      await db.delete(accounts).where(eq(accounts.userId, uid));
      await db.delete(users).where(eq(users.id, uid));
    }
    await app?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('uploads a PNG and lists it under the transaction', async () => {
    const { headers, payload } = await buildForm('receipt.png', PNG_BYTES, 'image/png');
    const up = await app.inject({
      method: 'POST',
      url: `/api/transactions/${txAId}/attachments`,
      headers: { cookie: cookieA, ...headers },
      payload,
    });
    expect(up.statusCode).toBe(201);
    const created = up.json().attachment as {
      id: number; filename: string; mime: string; sizeBytes: number;
    };
    expect(created.filename).toBe('receipt.png');
    expect(created.mime).toBe('image/png');
    expect(created.sizeBytes).toBe(PNG_BYTES.length);

    const list = await app.inject({
      method: 'GET',
      url: `/api/transactions/${txAId}/attachments`,
      headers: { cookie: cookieA },
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json().attachments as Array<{ id: number; filename: string }>;
    expect(rows.some((r) => r.id === created.id && r.filename === 'receipt.png')).toBe(true);
  });

  it('downloads the uploaded bytes with the original filename', async () => {
    const { headers, payload } = await buildForm('bill.png', PNG_BYTES, 'image/png');
    const up = await app.inject({
      method: 'POST',
      url: `/api/transactions/${txAId}/attachments`,
      headers: { cookie: cookieA, ...headers },
      payload,
    });
    const id = up.json().attachment.id as number;

    const dl = await app.inject({
      method: 'GET',
      url: `/api/attachments/${id}/download`,
      headers: { cookie: cookieA },
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(String(dl.headers['content-disposition'])).toContain('filename="bill.png"');
    // rawPayload is a Buffer; compare bytes rather than the utf-8 decode.
    expect(Buffer.from(dl.rawPayload).equals(PNG_BYTES)).toBe(true);
  });

  it('deletes an attachment (DB row + disk file)', async () => {
    const { headers, payload } = await buildForm('trash.png', PNG_BYTES, 'image/png');
    const up = await app.inject({
      method: 'POST',
      url: `/api/transactions/${txAId}/attachments`,
      headers: { cookie: cookieA, ...headers },
      payload,
    });
    const id = up.json().attachment.id as number;

    const { db } = await import('../src/db/client.js');
    const { transactionAttachments } = await import('../src/db/schema.js');
    const [row] = await db
      .select()
      .from(transactionAttachments)
      .where(eq(transactionAttachments.id, id));
    const absPath = path.join(tmp, 'attachments', row!.storedPath);
    expect(existsSync(absPath)).toBe(true);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/attachments/${id}`,
      headers: { cookie: cookieA },
    });
    expect(del.statusCode).toBe(204);
    const after = await db
      .select()
      .from(transactionAttachments)
      .where(eq(transactionAttachments.id, id));
    expect(after).toHaveLength(0);
    expect(existsSync(absPath)).toBe(false);
  });

  it('returns 404 when another user tries to list, download, or delete', async () => {
    const { headers, payload } = await buildForm('hidden.png', PNG_BYTES, 'image/png');
    const up = await app.inject({
      method: 'POST',
      url: `/api/transactions/${txAId}/attachments`,
      headers: { cookie: cookieA, ...headers },
      payload,
    });
    const id = up.json().attachment.id as number;

    const list = await app.inject({
      method: 'GET',
      url: `/api/transactions/${txAId}/attachments`,
      headers: { cookie: cookieB },
    });
    expect(list.statusCode).toBe(404);

    const dl = await app.inject({
      method: 'GET',
      url: `/api/attachments/${id}/download`,
      headers: { cookie: cookieB },
    });
    expect(dl.statusCode).toBe(404);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/attachments/${id}`,
      headers: { cookie: cookieB },
    });
    expect(del.statusCode).toBe(404);
  });

  it('returns 404 when user B uploads to user A\'s transaction', async () => {
    const { headers, payload } = await buildForm('poach.png', PNG_BYTES, 'image/png');
    const up = await app.inject({
      method: 'POST',
      url: `/api/transactions/${txAId}/attachments`,
      headers: { cookie: cookieB, ...headers },
      payload,
    });
    expect(up.statusCode).toBe(404);
  });

  it('rejects a spoofed MIME with 400 (text file claiming image/png)', async () => {
    const { headers, payload } = await buildForm(
      'evil.png',
      Buffer.from('This is just text, not a real PNG at all — full stop.'),
      'image/png',
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/transactions/${txBId}/attachments`,
      headers: { cookie: cookieB, ...headers },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unsupported file type/i);
  });

  it('rejects an oversize upload with 413', async () => {
    // 10 MB + 1 byte. Prepend real PNG magic so the fastify-multipart cap
    // fires before the MIME sniffer would (otherwise the request just gets
    // rejected as unsupported and we'd never exercise 413).
    const oversize = Buffer.concat([PNG_BYTES, Buffer.alloc(10 * 1024 * 1024 + 1)]);
    const { headers, payload } = await buildForm('huge.png', oversize, 'image/png');
    const res = await app.inject({
      method: 'POST',
      url: `/api/transactions/${txAId}/attachments`,
      headers: { cookie: cookieA, ...headers },
      payload,
    });
    expect(res.statusCode).toBe(413);
  });

  it('rejects an empty file with 400', async () => {
    const { headers, payload } = await buildForm('empty.png', Buffer.alloc(0), 'image/png');
    const res = await app.inject({
      method: 'POST',
      url: `/api/transactions/${txAId}/attachments`,
      headers: { cookie: cookieA, ...headers },
      payload,
    });
    expect(res.statusCode).toBe(400);
  });
});
