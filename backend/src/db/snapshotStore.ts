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
  return readFile(snapshotPath(dir));
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
  const markerFile = markerPath(dir);

  await rm(cur, { force: true });
  await rm(bak, { force: true });
  await rm(markerFile, { force: true });
}
