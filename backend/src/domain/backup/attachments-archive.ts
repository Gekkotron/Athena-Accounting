import { and, asc, eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { z } from 'zod';
import { db } from '../../db/client.js';
import {
  accounts,
  transactionAttachments,
  transactions,
} from '../../db/schema.js';
import {
  absPathFor,
  unlinkAttachment,
  writeAttachmentBytes,
} from '../attachments/storage.js';

// Separate archive channel for transaction attachments — receipts, invoices,
// contracts. Kept out of the main JSON dump (see backup/schema.ts) because
// inlining 10 MB × N receipts would blow up the envelope; the archive lives
// in its own encrypted file so users can back up structure + blobs on
// independent cadences. Wire format:
//
//   raw bytes = AES-256-GCM(salt|iv|tag|ciphertext) of gzip(JSON.stringify({
//     version: 1,
//     exportedAt: ISO,
//     attachments: [
//       { account, dedupKey, filename, mime, sizeBytes, createdAt, bytesBase64 },
//       …
//     ],
//   }))
//
// (account, dedupKey) is the natural key linking an archive entry back to
// its restored transaction — same shape restore.ts already uses for
// downstream refs. Attachments whose parent transaction didn't restore are
// silently skipped, matching the codebase's "unknown-name → drop" pattern.

export const ArchivedAttachmentSchema = z.object({
  account: z.string(),
  dedupKey: z.string(),
  filename: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string(),
  bytesBase64: z.string(),
});

export const AttachmentsArchiveSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  attachments: z.array(ArchivedAttachmentSchema),
});

export type AttachmentsArchive = z.infer<typeof AttachmentsArchiveSchema>;

// Build the archive struct from the caller's on-disk + DB state. Reads each
// file's bytes off disk; the caller downstream gzip+encrypts the JSON.
export async function buildAttachmentsArchive(uid: number): Promise<AttachmentsArchive> {
  const rows = await db
    .select({
      account: accounts.name,
      dedupKey: transactions.dedupKey,
      filename: transactionAttachments.filename,
      mime: transactionAttachments.mime,
      sizeBytes: transactionAttachments.sizeBytes,
      storedPath: transactionAttachments.storedPath,
      createdAt: transactionAttachments.createdAt,
    })
    .from(transactionAttachments)
    .innerJoin(transactions, eq(transactionAttachments.transactionId, transactions.id))
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(eq(transactionAttachments.userId, uid))
    .orderBy(asc(transactionAttachments.id));

  const entries = await Promise.all(
    rows.map(async (r) => {
      const bytes = await readFile(absPathFor(r.storedPath));
      return {
        account: r.account,
        dedupKey: r.dedupKey,
        filename: r.filename,
        mime: r.mime,
        sizeBytes: r.sizeBytes,
        createdAt: r.createdAt.toISOString(),
        bytesBase64: bytes.toString('base64'),
      };
    }),
  );

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    attachments: entries,
  };
}

// Restore an archive into the caller's user scope. REPLACE semantics matching
// the JSON dump's restore: every current attachment for this user is wiped
// from DB + disk before the archive is applied. Attachments whose parent
// transaction (looked up by natural key) is missing are counted under
// `skipped` and dropped — same convention as budgets/rules restore.
export interface RestoreResult {
  restored: number;
  skipped: number;
}

export async function restoreAttachmentsArchive(
  uid: number,
  archive: AttachmentsArchive,
): Promise<RestoreResult> {
  // 1. Snapshot the user's current on-disk paths BEFORE wiping the DB rows —
  //    we need to unlink them after the DB is clean but before the fresh
  //    writes start (so a re-run of the same archive doesn't collide).
  const before = await db
    .select({ storedPath: transactionAttachments.storedPath })
    .from(transactionAttachments)
    .where(eq(transactionAttachments.userId, uid));

  // 2. Wipe the DB rows. Kept outside a transaction because attachment
  //    restore is idempotent enough at the row grain — a partial failure
  //    leaves rows the user can view/delete, not a broken FK graph.
  await db
    .delete(transactionAttachments)
    .where(eq(transactionAttachments.userId, uid));

  // 3. Best-effort disk cleanup for the paths we just orphaned.
  for (const row of before) {
    await unlinkAttachment(row.storedPath);
  }

  // 4. Build the (account, dedupKey) → transaction id map once. Bounded by
  //    the user's own transaction count — small enough to hold in memory.
  const txRows = await db
    .select({
      id: transactions.id,
      account: accounts.name,
      dedupKey: transactions.dedupKey,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(eq(transactions.userId, uid));

  const txIdByKey = new Map<string, number>();
  for (const t of txRows) {
    txIdByKey.set(`${t.account}::${t.dedupKey}`, t.id);
  }

  // 5. Insert one row per entry, then write bytes to disk. Row-first so the
  //    on-disk filename can derive from the freshly-allocated id.
  let restored = 0;
  let skipped = 0;
  for (const entry of archive.attachments) {
    const txId = txIdByKey.get(`${entry.account}::${entry.dedupKey}`);
    if (txId == null) {
      skipped++;
      continue;
    }
    const bytes = Buffer.from(entry.bytesBase64, 'base64');
    if (bytes.length !== entry.sizeBytes) {
      // sizeBytes is metadata — trust the actual decoded length for storage
      // but keep the mismatch out of `restored` so callers can flag it.
      skipped++;
      continue;
    }
    const [row] = await db
      .insert(transactionAttachments)
      .values({
        userId: uid,
        transactionId: txId,
        filename: entry.filename,
        mime: entry.mime,
        sizeBytes: bytes.length,
        storedPath: '',
      })
      .returning();
    if (!row) {
      skipped++;
      continue;
    }
    try {
      const rel = await writeAttachmentBytes(uid, row.id, bytes);
      await db
        .update(transactionAttachments)
        .set({ storedPath: rel })
        .where(eq(transactionAttachments.id, row.id));
      restored++;
    } catch {
      // Rollback the reservation row so a disk-write failure doesn't leave
      // a DB row pointing at nothing — same guard used in the upload route.
      await db
        .delete(transactionAttachments)
        .where(and(eq(transactionAttachments.id, row.id), eq(transactionAttachments.userId, uid)));
      skipped++;
    }
  }

  return { restored, skipped };
}

// Wire helpers: JSON → gzip → Buffer, and back. Kept alongside the archive
// so callers see the two ends of the pipeline together.
export function archiveToGzippedJson(archive: AttachmentsArchive): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(archive), 'utf8'));
}

export function parseGzippedJsonToArchive(gzipped: Buffer): AttachmentsArchive {
  const json = gunzipSync(gzipped).toString('utf8');
  const parsed = JSON.parse(json);
  return AttachmentsArchiveSchema.parse(parsed);
}
