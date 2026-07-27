import { open, rm, rename, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function snapshotPath(dir: string): string {
  return path.join(dir, 'athena.db.enc');
}

export function backupSnapshotPath(dir: string): string {
  return path.join(dir, 'athena.db.enc.bak');
}

export function markerPath(dir: string): string {
  return path.join(dir, 'security.json');
}

export async function writeSnapshot(dir: string, file: Buffer): Promise<void> {
  const tmp = path.join(dir, 'athena.db.enc.tmp');
  const cur = snapshotPath(dir);
  const bak = backupSnapshotPath(dir);

  // 0o600 (owner read/write only) — matches the .mcp-port precedent
  // (entry/tauri.ts): this file holds an encrypted snapshot of the whole
  // database, no other local account should even be able to read it.
  const fh = await open(tmp, 'w', 0o600);
  try {
    await fh.writeFile(file);
    await fh.sync();
  } finally {
    await fh.close();
  }

  if (existsSync(cur)) {
    // Rotate the current snapshot into .bak before replacing it — but only
    // when there IS a current snapshot to rotate. If `cur` is already
    // missing (e.g. we're writing a fresh snapshot right after recovering
    // via readSnapshot()'s .bak fallback below), the existing .bak is the
    // only remaining copy of the previous good snapshot; unconditionally
    // clearing it here would open a window with *zero* snapshots on disk if
    // the process died between that and the final rename below.
    await rm(bak, { force: true });
    await rename(cur, bak);
  }
  await rename(tmp, cur);
}

export async function readSnapshot(dir: string): Promise<Buffer> {
  try {
    return await readFile(snapshotPath(dir));
  } catch (err) {
    // writeSnapshot()'s rotation (write tmp, rename cur -> .bak, rename tmp
    // -> cur) is two separate renames, not one atomic operation. A crash
    // between them leaves `cur` missing while `.bak` still holds the
    // previous — still valid, still decryptable — snapshot. Fall back to it
    // rather than treating "no current file" as "no snapshot at all", which
    // would otherwise look identical to a fresh, never-encrypted install.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return readFile(backupSnapshotPath(dir));
    }
    throw err;
  }
}

export async function hasSnapshot(dir: string): Promise<boolean> {
  // Must agree with readSnapshot()'s .bak fallback above: if only `.bak`
  // exists (cur missing, e.g. mid-rotation crash), there IS a recoverable
  // snapshot, and callers gating "is there anything encrypted here" (the
  // marker-missing corruption guard in tauri.ts) must see that, rather than
  // concluding it's safe to boot a fresh empty database.
  return existsSync(snapshotPath(dir)) || existsSync(backupSnapshotPath(dir));
}

export async function readMarker(
  dir: string,
): Promise<'encrypted' | 'disable-pending' | null> {
  const markerFile = markerPath(dir);
  if (!existsSync(markerFile)) {
    return null;
  }

  try {
    const content = await readFile(markerFile, 'utf8');
    const parsed = JSON.parse(content) as unknown;

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'mode' in parsed &&
      typeof (parsed as Record<string, unknown>).mode === 'string'
    ) {
      const mode = (parsed as Record<string, unknown>).mode as string;
      if (mode === 'encrypted' || mode === 'disable-pending') {
        return mode;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function writeMarker(
  dir: string,
  mode: 'encrypted' | 'disable-pending',
): Promise<void> {
  const markerFile = markerPath(dir);
  const content = JSON.stringify({ mode });
  await writeFile(markerFile, content, { mode: 0o600 });
}

// Removes just the rotated-out backup snapshot, keeping the current one and
// the marker intact. Used after a password change: the .bak file still
// holds the pre-change ciphertext, which is still decryptable under the OLD
// password — a change must actually revoke the old password's ability to
// open a copy of the data, not just make the new one work too.
export async function removeBackupSnapshot(dir: string): Promise<void> {
  await rm(backupSnapshotPath(dir), { force: true });
}

export async function clearEncryption(dir: string): Promise<void> {
  const cur = snapshotPath(dir);
  const bak = backupSnapshotPath(dir);
  const tmp = path.join(dir, 'athena.db.enc.tmp');
  const markerFile = markerPath(dir);

  await rm(cur, { force: true });
  await rm(bak, { force: true });
  await rm(tmp, { force: true });
  await rm(markerFile, { force: true });
}
