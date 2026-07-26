import { open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

export const LOCK_FILENAME = '.sidecar.lock';

export class AlreadyRunningError extends Error {
  constructor(public readonly holderPid: number) {
    super(
      `another sidecar (pid ${holderPid}) already has this data directory open — ` +
        'PGlite supports a single process only',
    );
    this.name = 'AlreadyRunningError';
  }
}

// `signal 0` probes existence without sending anything. EPERM means the pid
// exists but belongs to another user — still "alive" for our purposes.
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// Guard the PGlite data directory against a second concurrent sidecar.
// Opening the same datadir from two processes is unsupported by PGlite and
// wedges Postgres-in-WASM in a busy-wait (observed as 100% CPU forever on a
// stuck import). A pid file with a liveness check is used instead of flock:
// it needs no native dependency and behaves the same on Windows.
//
// Returns a release function that removes the lock; throws
// AlreadyRunningError when a live process holds it.
export async function acquireSingleInstanceLock(
  dir: string,
): Promise<() => Promise<void>> {
  const lockPath = path.join(dir, LOCK_FILENAME);
  // Two attempts: first may find a stale lock (holder died without cleanup —
  // e.g. force quit); we remove it and try once more. A second EEXIST means
  // we raced another starting instance, which is exactly the case to refuse.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(lockPath, 'wx');
      try {
        await fh.writeFile(`${process.pid}\n`);
      } finally {
        await fh.close();
      }
      return async () => {
        await rm(lockPath, { force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const raw = await readFile(lockPath, 'utf8').catch(() => '');
      const holderPid = Number.parseInt(raw.trim(), 10);
      if (Number.isInteger(holderPid) && holderPid > 0 && isProcessAlive(holderPid)) {
        throw new AlreadyRunningError(holderPid);
      }
      // Stale (dead holder or unparseable content) — remove and retry.
      await rm(lockPath, { force: true });
    }
  }
  throw new AlreadyRunningError(0);
}
