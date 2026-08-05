import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFolderProvider, BackupProviderError } from '../src/domain/backup/providers.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'athena-backup-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NAME = 'athena-backup-2026-08-05-030000.enc.json';

describe('folder provider', () => {
  it('requires an absolute path', () => {
    expect(() => createFolderProvider('relative/dir')).toThrow(BackupProviderError);
  });
  it('uploads via temp file + rename and leaves no temp behind', async () => {
    const p = createFolderProvider(dir);
    await p.upload(NAME, Buffer.from('{"v":"enc1"}'));
    expect((await readFile(join(dir, NAME))).toString()).toBe('{"v":"enc1"}');
    expect(await readdir(dir)).toEqual([NAME]); // no .tmp-* residue
  });
  it('a failed write cleans up its temp file', async () => {
    const p = createFolderProvider(join(dir, 'does-not-exist'));
    await expect(p.upload(NAME, Buffer.from('x'))).rejects.toThrow(BackupProviderError);
  });
  it('list() returns only backup-named files', async () => {
    const p = createFolderProvider(dir);
    await p.upload(NAME, Buffer.from('x'));
    await writeFile(join(dir, 'holiday-photos.zip'), 'not ours');
    expect(await p.list()).toEqual([NAME]);
  });
  it('remove() deletes a backup file and rejects path traversal', async () => {
    const p = createFolderProvider(dir);
    await p.upload(NAME, Buffer.from('x'));
    await p.remove(NAME);
    expect(await readdir(dir)).toEqual([]);
    await expect(p.remove('../evil')).rejects.toThrow(BackupProviderError);
  });
});
