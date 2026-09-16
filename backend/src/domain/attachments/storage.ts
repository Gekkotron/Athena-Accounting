import { createWriteStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir } from '../../dataDir.js';

// Attachments live under DATA_DIR/attachments/<user_id>/<attachment_id>.bin.
// The DB row's `stored_path` holds the path relative to `attachmentsRoot()`
// so a storage rework never forces a schema migration. Callers should treat
// `stored_path` as an opaque token and always join it with `attachmentsRoot()`.

export function attachmentsRoot(): string {
  return join(dataDir(), 'attachments');
}

export function absPathFor(storedPath: string): string {
  return join(attachmentsRoot(), storedPath);
}

// Relative-path builder for a fresh upload — deterministic from (userId, id)
// so tests can reason about the layout without probing the filesystem.
export function relPathFor(userId: number, attachmentId: number): string {
  return `${userId}/${attachmentId}.bin`;
}

export async function writeAttachmentBytes(
  userId: number,
  attachmentId: number,
  buffer: Buffer,
): Promise<string> {
  const rel = relPathFor(userId, attachmentId);
  const abs = absPathFor(rel);
  await mkdir(join(attachmentsRoot(), String(userId)), { recursive: true });
  await writeFile(abs, buffer);
  return rel;
}

// Streaming write used by the multipart upload path (perf audit 2026-09-11).
// Consumes chunks from a Readable, forwards each one to fs.createWriteStream,
// counts total bytes on the fly, and keeps the first 16 bytes for the caller's
// magic-bytes MIME sniff. Avoids buffering the whole file in memory. On any
// error, the partial file is best-effort unlinked before the promise rejects.
export async function writeAttachmentStream(
  userId: number,
  attachmentId: number,
  source: NodeJS.ReadableStream,
): Promise<{ rel: string; sizeBytes: number; head: Buffer }> {
  const rel = relPathFor(userId, attachmentId);
  const abs = absPathFor(rel);
  await mkdir(join(attachmentsRoot(), String(userId)), { recursive: true });
  const write = createWriteStream(abs);
  const headParts: Buffer[] = [];
  let headLen = 0;
  let sizeBytes = 0;
  try {
    for await (const raw of source as AsyncIterable<Buffer | string>) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      sizeBytes += chunk.length;
      if (headLen < 16) {
        const need = 16 - headLen;
        const bit = chunk.length <= need ? chunk : chunk.subarray(0, need);
        headParts.push(bit);
        headLen += bit.length;
      }
      if (!write.write(chunk)) {
        await new Promise<void>((resolve) => write.once('drain', () => resolve()));
      }
    }
    await new Promise<void>((resolve, reject) =>
      write.end((err?: Error | null) => (err ? reject(err) : resolve())),
    );
  } catch (err) {
    write.destroy();
    await unlink(abs).catch(() => undefined);
    throw err;
  }
  return { rel, sizeBytes, head: Buffer.concat(headParts) };
}

export async function unlinkAttachment(storedPath: string): Promise<void> {
  try {
    await unlink(absPathFor(storedPath));
  } catch (err: unknown) {
    // ENOENT is fine — the file was already gone (e.g. manual cleanup after
    // a partially-restored backup, or a previous failed delete). Every other
    // error propagates so the caller can log it.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
}
