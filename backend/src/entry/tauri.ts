// Tauri desktop entry point. The Rust shell spawns this binary, parses the
// `ATHENA_PORT=<n>` line from stdout to learn where the backend bound, then
// points its WebView at http://127.0.0.1:<port>. On window close the shell
// sends SIGTERM — we close Fastify cleanly and exit.
//
// Env is pinned here (not read from the shell) because Tauri users don't set
// env vars — the desktop distribution is a single embedded configuration:
// PGlite driver, no auth, data under DATA_DIR (defaults to CWD).
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const dataDir = process.env.DATA_DIR ?? process.cwd();
await mkdir(dataDir, { recursive: true });

process.env.DB_DRIVER = 'pglite';
process.env.AUTH_MODE = 'none';
process.env.PGLITE_PATH = path.join(dataDir, 'athena.db');
// env.ts requires SESSION_SECRET >= 32 chars even when auth is off. The
// Tauri app has no remote surface (127.0.0.1 only) so a fixed local secret
// is fine — sessions are per-install, not shared.
process.env.SESSION_SECRET ??= 'athena-tauri-local-session-secret-not-remote';

// Dynamic imports so the env writes above land before env.ts is evaluated.
const { build } = await import('../buildServer.js');
const { runMigrations } = await import('../db/migrate.js');
const { pool } = await import('../db/client.js');
const { ensureLocalUser } = await import('../domain/auth/localUser.js');

await runMigrations();
await ensureLocalUser();

const app = await build();

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

const address = await app.listen({ host: '127.0.0.1', port: 0 });
// Fastify's listen() returns the bound URL; extract the port for the Rust
// shell. `server.address()` also works but the URL parse is driver-agnostic.
const port = new URL(address).port;
// Single machine-readable line the Rust shell greps for. Must be exact —
// no logger prefix, no trailing whitespace beyond the newline.
process.stdout.write(`ATHENA_PORT=${port}\n`);
