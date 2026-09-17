import { readFile, writeFile, stat, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

// The constant that shipped in every Tauri build up to and including v0.x.y
// (release before 2026-09-17). Used as the KDF input for TOTP, bank-sync,
// MCP wrap and backup-destination secrets on every existing install. Kept
// exported so the one-shot legacy migration can derive the old keys and
// rewrite ciphertexts under the fresh per-install secret.
export const LEGACY_TAURI_SESSION_SECRET = 'athena-tauri-local-session-secret-not-remote';

const SESSION_SECRET_FILENAME = 'session-secret.bin';
const MIN_SECRET_CHARS = 32;

export type SessionSecretResult = {
  secret: string;
  needsMigration: boolean;
  secretPath: string;
};

// Idempotent: safe to call every boot. Contract:
//   - If <dir>/session-secret.bin exists → return its content, no migration.
//   - Else if the PGlite datadir exists (legacy install) → return a FRESH
//     random secret with `needsMigration: true`. The caller must run the
//     legacy re-encrypt migration and then persist the file via
//     `writeSessionSecretFile` — no file is written from here in that case.
//   - Else (fresh install) → return a FRESH random secret AND persist the
//     file immediately (no rows exist to migrate).
export async function ensureSessionSecret(dir: string): Promise<SessionSecretResult> {
  const secretPath = path.join(dir, SESSION_SECRET_FILENAME);

  const existing = await readFile(secretPath, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null;
    throw err;
  });

  if (existing !== null) {
    const trimmed = existing.trim();
    if (trimmed.length < MIN_SECRET_CHARS) {
      throw new Error(
        `${SESSION_SECRET_FILENAME} is corrupted (fewer than ${MIN_SECRET_CHARS} chars). ` +
          `Refusing to boot — restore a backup or delete athena.db + this file to reinitialise.`,
      );
    }
    return { secret: trimmed, needsMigration: false, secretPath };
  }

  const secret = randomBytes(32).toString('hex');
  const hasDatadir = await stat(path.join(dir, 'athena.db')).then(
    (s) => s.isDirectory(),
    () => false,
  );

  if (!hasDatadir) {
    await writeSessionSecretFile(secretPath, secret);
    return { secret, needsMigration: false, secretPath };
  }

  return { secret, needsMigration: true, secretPath };
}

// Writes the secret to disk with `mode: 0o600`. On POSIX the mode lands
// atomically at file-create time; the follow-up chmod is defensive against
// filesystems that ignored the create mode. On Windows the chmod is a
// best-effort no-op — Windows uses ACLs instead, and the app-data directory
// is already per-user (see Tauri's `app_data_dir()`).
export async function writeSessionSecretFile(secretPath: string, secret: string): Promise<void> {
  await writeFile(secretPath, secret + '\n', { mode: 0o600 });
  await chmod(secretPath, 0o600).catch(() => { /* Windows / SMB share */ });
}
