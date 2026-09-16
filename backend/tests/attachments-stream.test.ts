// Perf-audit regression guard for the streaming attachment upload
// (2026-09-11 audit). Pre-refactor the handler read the full multipart
// body into a Buffer via data.toBuffer(), then INSERTed a placeholder
// row, wrote the bytes to disk, and UPDATEd storedPath onto the row —
// two DB writes per upload plus a Buffer proportional to file size.
// Post-refactor: reserve the id via nextval(), stream chunks straight
// to disk, single INSERT with the final path. One DB write path
// (INSERT), memory footprint bounded to a single chunk at a time.
// Requires RUN_DB_TESTS=1 (touches the DB + disk).
import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

// Minimal valid PNG (1×1 red pixel) — real magic bytes so the sniffer
// accepts it. Base64 lifted from tooling; do not tweak.
const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8//8/AwAI/AL+XJTsuwAAAABJRU5ErkJggg==';

d('POST /api/transactions/:id/attachments — streaming write path', () => {
  it('uploads through a single INSERT (no follow-up UPDATE) and lands the file on disk', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'attach-stream-'));
    process.env.DATA_DIR = tmp;
    try {
      const { buildApp } = await import('./helpers/build-app.js');
      const { seedUserAndCookie, seedAccount } = await import('./helpers/seedUserAndCookie.js');
      const { db } = await import('../src/db/client.js');
      const { transactions } = await import('../src/db/schema.js');
      const FormData = (await import('form-data')).default;

      const app = await buildApp();
      const { cookie, uid } = await seedUserAndCookie(app);
      const accountId = await seedAccount(uid);
      const [tx] = await db.insert(transactions).values({
        userId: uid, accountId, date: '2026-06-15', amount: '-1.00',
        rawLabel: 'stream-target', normalizedLabel: 'stream-target',
        dedupKey: 'stream-1', categorySource: 'auto',
      }).returning({ id: transactions.id });

      // Build the head of a large PNG-style payload — magic bytes come from
      // the real 1×1 PNG (accepted by the sniffer), padded to ~256 KB to
      // exercise the multi-chunk streaming path without slowing the suite.
      const png = Buffer.from(PNG_1x1_BASE64, 'base64');
      const bigPayload = Buffer.concat([png, Buffer.alloc(256 * 1024 - png.length, 0)]);
      const form = new FormData();
      form.append('file', bigPayload, { filename: 'big.png', contentType: 'image/png' });

      // Spy on db.insert/update/delete for the DURATION of the upload only.
      let counts = { insert: 0, update: 0, delete: 0 };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const origInsert = (db as any).insert.bind(db);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const origUpdate = (db as any).update.bind(db);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const origDelete = (db as any).delete.bind(db);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).insert = (...args: unknown[]) => { counts.insert++; return origInsert(...args); };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).update = (...args: unknown[]) => { counts.update++; return origUpdate(...args); };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).delete = (...args: unknown[]) => { counts.delete++; return origDelete(...args); };

      let res;
      try {
        res = await app.inject({
          method: 'POST', url: `/api/transactions/${tx!.id}/attachments`,
          headers: { cookie, ...form.getHeaders() },
          payload: form.getBuffer(),
        });
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (db as any).insert = origInsert;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (db as any).update = origUpdate;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (db as any).delete = origDelete;
      }

      expect(res.statusCode).toBe(201);
      const attachment = res.json().attachment;
      expect(attachment.sizeBytes).toBe(bigPayload.length);
      expect(attachment.mime).toBe('image/png');

      // Single DB write per upload: exactly one INSERT, no UPDATE, no
      // rollback DELETE. Pre-refactor this would have been INSERT + UPDATE.
      expect(counts.insert).toBe(1);
      expect(counts.update).toBe(0);
      expect(counts.delete).toBe(0);

      // And the file actually landed on disk at the deterministic path
      // storage.ts computes from (uid, id).
      const abs = path.join(tmp, 'attachments', String(uid), `${attachment.id}.bin`);
      const st = await stat(abs);
      expect(st.size).toBe(bigPayload.length);

      await app.close();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
