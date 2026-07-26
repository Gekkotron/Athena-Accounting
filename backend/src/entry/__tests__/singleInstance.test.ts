import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  acquireSingleInstanceLock,
  AlreadyRunningError,
  LOCK_FILENAME,
} from '../singleInstance.js';

describe('acquireSingleInstanceLock', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'athena-lock-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates a lock file holding our pid', async () => {
    const release = await acquireSingleInstanceLock(dir);
    const lockPath = path.join(dir, LOCK_FILENAME);
    expect(existsSync(lockPath)).toBe(true);
    expect((await readFile(lockPath, 'utf8')).trim()).toBe(String(process.pid));
    await release();
  });

  it('release removes the lock file', async () => {
    const release = await acquireSingleInstanceLock(dir);
    await release();
    expect(existsSync(path.join(dir, LOCK_FILENAME))).toBe(false);
  });

  it('throws AlreadyRunningError when a live process holds the lock', async () => {
    // Our own pid is definitely alive.
    await writeFile(path.join(dir, LOCK_FILENAME), String(process.pid));
    await expect(acquireSingleInstanceLock(dir)).rejects.toBeInstanceOf(AlreadyRunningError);
  });

  it('reports the holder pid in the error', async () => {
    await writeFile(path.join(dir, LOCK_FILENAME), String(process.pid));
    const err = await acquireSingleInstanceLock(dir).catch((e) => e);
    expect(err).toBeInstanceOf(AlreadyRunningError);
    expect((err as AlreadyRunningError).holderPid).toBe(process.pid);
  });

  it('steals a stale lock left by a dead process', async () => {
    // 99999999 exceeds every platform's pid range, so no live process can
    // hold it — equivalent to a holder that has exited.
    await writeFile(path.join(dir, LOCK_FILENAME), '99999999');
    const release = await acquireSingleInstanceLock(dir);
    expect((await readFile(path.join(dir, LOCK_FILENAME), 'utf8')).trim()).toBe(
      String(process.pid),
    );
    await release();
  });

  it('steals a lock file with unparseable contents', async () => {
    await writeFile(path.join(dir, LOCK_FILENAME), 'not-a-pid');
    const release = await acquireSingleInstanceLock(dir);
    expect(existsSync(path.join(dir, LOCK_FILENAME))).toBe(true);
    await release();
  });
});
