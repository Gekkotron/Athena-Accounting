import { open, rm, rename, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function snapshotPath(dir: string): string {
  return path.join(dir, 'athena.db.enc');
}

export function markerPath(dir: string): string {
  return path.join(dir, 'security.json');
}

export async function writeSnapshot(dir: string, file: Buffer): Promise<void> {
  const tmp = path.join(dir, 'athena.db.enc.tmp');
  const cur = path.join(dir, 'athena.db.enc');
  const bak = path.join(dir, 'athena.db.enc.bak');

  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(file);
    await fh.sync();
  } finally {
    await fh.close();
  }

  await rm(bak, { force: true });
  await rename(cur, bak).catch((e) => {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  });
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
      return readFile(path.join(dir, 'athena.db.enc.bak'));
    }
    throw err;
  }
}

export async function hasSnapshot(dir: string): Promise<boolean> {
  return existsSync(snapshotPath(dir));
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
  await writeFile(markerFile, content);
}

export async function clearEncryption(dir: string): Promise<void> {
  const cur = snapshotPath(dir);
  const bak = path.join(dir, 'athena.db.enc.bak');
  const tmp = path.join(dir, 'athena.db.enc.tmp');
  const markerFile = markerPath(dir);

  await rm(cur, { force: true });
  await rm(bak, { force: true });
  await rm(tmp, { force: true });
  await rm(markerFile, { force: true });
}
