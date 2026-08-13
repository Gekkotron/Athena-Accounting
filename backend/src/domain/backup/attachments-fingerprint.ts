import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { transactionAttachments } from '../../db/schema.js';

// Cheap "have my attachments changed?" signal for the scheduled backup
// runner. Not cryptographic — collisions here just mean a skipped upload,
// and the input space is (count, maxCreatedAt) so real changes always
// touch at least one field:
//   * an INSERT bumps count AND maxCreatedAt
//   * a DELETE bumps count (down); maxCreatedAt may stay the same or
//     regress, either of which shifts the hash
//
// A rename or an in-place bytes swap without touching the DB row wouldn't
// register — but the current attachments API never mutates a row after
// insert, so that path can't be reached today.

export interface AttachmentFingerprintInput {
  count: number;
  // node-pg returns a Date; PGlite returns a raw string; both are accepted
  // and coerced to a stable ISO representation before hashing.
  maxCreatedAt: Date | string | null;
}

function toIso(v: Date | string | null): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  // Assume the driver already gave us an ISO-8601 or Postgres timestamp
  // string; feed it back through Date to normalize the format so a driver
  // swap doesn't shift the hash for the same underlying moment.
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

export function computeAttachmentFingerprint(input: AttachmentFingerprintInput): string {
  return createHash('sha256').update(`${input.count}::${toIso(input.maxCreatedAt)}`).digest('hex');
}

export async function readAttachmentFingerprint(uid: number): Promise<string> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      maxCreatedAt: sql<Date | string | null>`max(${transactionAttachments.createdAt})`,
    })
    .from(transactionAttachments)
    .where(eq(transactionAttachments.userId, uid));
  return computeAttachmentFingerprint({
    count: Number(row?.count ?? 0),
    maxCreatedAt: row?.maxCreatedAt ?? null,
  });
}
