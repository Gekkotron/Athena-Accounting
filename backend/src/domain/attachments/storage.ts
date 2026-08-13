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
