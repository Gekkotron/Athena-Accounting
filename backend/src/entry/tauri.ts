// Tauri desktop entry point. The Rust shell spawns this binary, parses the
// `ATHENA_PORT=<n>` line from stdout to learn where the backend bound, then
// points its WebView at http://127.0.0.1:<port>. On window close the shell
// sends SIGTERM — we close Fastify cleanly and exit.
//
// Env is pinned here (not read from the shell) because Tauri users don't set
// env vars — the desktop distribution is a single embedded configuration:
// PGlite driver, no auth, data under DATA_DIR (defaults to CWD).
import { mkdir, writeFile, unlink, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from '../dataDir.js';
import { acquireSingleInstanceLock, AlreadyRunningError } from './singleInstance.js';
import { startParentWatchdog } from './parentWatchdog.js';
import { runUnlockServer } from './unlockServer.js';
import {
  readMarker, clearEncryption, readSnapshot, writeSnapshot,
} from '../db/snapshotStore.js';
import { encryptBuffer, decryptBuffer } from '../lib/binaryEnvelope.js';

// `Buffer`'s `.buffer` is typed `ArrayBufferLike` (it may be backed by a
// `SharedArrayBuffer`), which `BlobPart`/`Uint8Array<ArrayBuffer>` reject.
// `new Uint8Array(buf)` copies into a fresh, plain `ArrayBuffer`-backed view,
// satisfying the type and giving PGlite's `loadDataDir` a Blob it accepts.
function toBlob(buf: Buffer): Blob {
  return new Blob([new Uint8Array(buf)]);
}

// If the Tauri shell dies without cleaning us up (force quit, crash), exit
// instead of lingering as an orphan that keeps the PGlite datadir open.
startParentWatchdog();

const dir = dataDir();
await mkdir(dir, { recursive: true });

// PGlite tolerates exactly one process per data directory; a concurrent
// second sidecar (typically an orphan from a force-quit shell) wedges
// Postgres-in-WASM in a 100%-CPU busy-wait on the next write. The
// ATHENA_FATAL line is machine-readable — the Rust shell surfaces it instead
// of timing out waiting for ATHENA_PORT.
let releaseLock: () => Promise<void>;
try {
  releaseLock = await acquireSingleInstanceLock(dir);
} catch (err) {
  if (err instanceof AlreadyRunningError) {
    process.stdout.write(`ATHENA_FATAL=${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

process.env.DB_DRIVER = 'pglite';
process.env.AUTH_MODE = 'none';
process.env.PGLITE_PATH = path.join(dir, 'athena.db');
// The Tauri distribution is self-contained: one process serves both the API
// and the built frontend. STATIC_ROOT is left overridable so the Rust shell
// can point at the bundled resource directory.
process.env.SERVE_STATIC ??= 'true';
// env.ts requires SESSION_SECRET >= 32 chars even when auth is off. The
// Tauri app has no remote surface (127.0.0.1 only) so a fixed local secret
// is fine — sessions are per-install, not shared.
process.env.SESSION_SECRET ??= 'athena-tauri-local-session-secret-not-remote';

// Advertise the bound port to local MCP clients. `${DATA_DIR}/.mcp-port` is
// the well-known contract: the MCP bridge (mcp/dist/index.js) resolves its
// backend URL from this file when the user sets ATHENA_PORT_FILE in their
// Claude Desktop / Cursor / mcphost config. See docs/users/mcp.md. Declared
// early (rather than after `build()`, as before) because the locked-boot
// path below needs to publish it as soon as the unlock server binds.
const portFile = path.join(dir, '.mcp-port');

// Locked boot: a security marker means the on-disk snapshot is encrypted (or
// a disable was requested last session) and there's no plaintext database to
// serve yet. Bind the tiny unlock server first, print its port as the usual
// ATHENA_PORT contract line so the Rust shell points the WebView at it
// immediately, and block here until the right password comes in.
const marker = await readMarker(dir);
let unlockedPort: number | undefined;
if (marker !== null) {
  const unlock = await runUnlockServer({ dir });
  process.stdout.write(`ATHENA_PORT=${unlock.port}\n`);
  await writeFile(portFile, `${unlock.port}\n`, { mode: 0o600 });
  unlockedPort = unlock.port;

  if (marker === 'disable-pending') {
    // Materialize the plaintext datadir from the just-decrypted snapshot,
    // then drop the encryption marker so the normal boot below finds a
    // plain filesystem-backed PGlite exactly as if encryption had never
    // been enabled.
    const { PGlite } = await import('@electric-sql/pglite');
    const back = await PGlite.create({
      dataDir: process.env.PGLITE_PATH,
      loadDataDir: toBlob(unlock.snapshot),
    });
    await back.close();
    await clearEncryption(dir);
  } else {
    // marker === 'encrypted'.
    if (existsSync(process.env.PGLITE_PATH)) {
      // Crash before the plaintext cleanup below ever ran (e.g. a prior
      // enable-migration or a prior run of this very branch got killed
      // mid-flight): the on-disk datadir is fresher than the snapshot we
      // just decrypted. Re-snapshot from the datadir — it's the truth —
      // then remove it so we never boot from stale plaintext again.
      const { PGlite } = await import('@electric-sql/pglite');
      const p = await PGlite.create({ dataDir: process.env.PGLITE_PATH });
      const dump = Buffer.from(await (await p.dumpDataDir('gzip')).arrayBuffer());
      await p.close();
      await writeSnapshot(dir, encryptBuffer(dump, unlock.passphrase));
      await rm(process.env.PGLITE_PATH, { recursive: true, force: true });
      (globalThis as Record<string, unknown>).__athenaLoadDataDir = toBlob(dump);
    } else {
      (globalThis as Record<string, unknown>).__athenaLoadDataDir =
        toBlob(decryptBuffer(await readSnapshot(dir), unlock.passphrase));
    }
    // Dynamic import, and only *after* the globalThis blob above is set:
    // snapshotScheduler.ts pulls in db/client.ts, which does a
    // top-level-await PGlite connect that reads `__athenaLoadDataDir` off
    // globalThis the instant it's evaluated. Importing it any earlier would
    // make that connect fall back to the filesystem `dataDir` instead of
    // loading the decrypted snapshot from memory — exactly the plaintext
    // disk write this whole flow exists to avoid. (It must also load after
    // the process.env writes above so env.ts parses — see
    // snapshotScheduler.test.ts for the same caveat on the test side.)
    const { activateSnapshots } = await import('../db/snapshotScheduler.js');
    // Safe: the module holds the passphrase in memory until the dynamic
    // imports below wire up the real PGlite instance from the blob just set.
    activateSnapshots(unlock.passphrase);
  }
}

// Dynamic imports so the env writes above land before env.ts is evaluated.
const { build } = await import('../buildServer.js');
const { runMigrations } = await import('../db/migrate.js');
const { pool } = await import('../db/client.js');
const { ensureLocalUser } = await import('../domain/auth/localUser.js');
const { isSnapshotActive, snapshotNow } = await import('../db/snapshotScheduler.js');

await runMigrations();
await ensureLocalUser();

const app = await build();

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  try {
    await unlink(portFile).catch(() => { /* file may not exist */ });
    if (isSnapshotActive()) {
      await snapshotNow();
    }
    // Re-read rather than trusting the boot-time `marker` — a disable
    // request during this session flips it to 'disable-pending', and that
    // finalization happens on the *next* boot, not here.
    const currentMarker = await readMarker(dir);
    if (currentMarker === 'encrypted' && existsSync(process.env.PGLITE_PATH ?? '')) {
      // Enable-migration finalization: the encrypted snapshot is confirmed
      // written (readMarker only ever returns 'encrypted' after the
      // security route verified it — see http/routes/security.ts), so the
      // plaintext datadir left over from before encryption was enabled is
      // now redundant and safe to remove.
      await rm(process.env.PGLITE_PATH as string, { recursive: true, force: true });
    }
    await app.close();
    await pool.end();
    await releaseLock();
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// When the unlock phase already bound a port (locked boot), rebind the real
// app to that exact port — the Rust shell's WebView already navigated there
// off the ATHENA_PORT line printed above, and the unlock server just
// released it. A short retry absorbs the brief window between its
// server.close() and the OS actually freeing the socket.
let address: string | undefined;
for (let i = 0; i < 25; i++) {
  try {
    address = await app.listen({ host: '127.0.0.1', port: unlockedPort ?? 0 });
    break;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || unlockedPort === undefined) throw err;
    await new Promise((r) => setTimeout(r, 200));
  }
}
if (!address) throw new Error('could not rebind the unlock port');

// Fastify's listen() returns the bound URL; extract the port for the Rust
// shell. `server.address()` also works but the URL parse is driver-agnostic.
const port = new URL(address).port;
await writeFile(portFile, `${port}\n`, { mode: 0o600 });
// Single machine-readable line the Rust shell greps for. Must be exact — no
// logger prefix, no trailing whitespace beyond the newline. Printed only
// once overall: the locked-boot path above already sent it when it applies.
if (unlockedPort === undefined) {
  process.stdout.write(`ATHENA_PORT=${port}\n`);
}
