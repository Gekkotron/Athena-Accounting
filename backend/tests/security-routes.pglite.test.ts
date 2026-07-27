// Integration test for the desktop encryption-at-rest control plane
// (/api/security). Runs entirely against an embedded PGlite instance — no
// external Postgres, no RUN_DB_TESTS gate — mirroring the boot sequence the
// Tauri entry point (src/entry/tauri.ts) uses: pin env -> runMigrations ->
// ensureLocalUser -> build().
//
// Env is set BEFORE any of these modules are imported: env.ts and client.ts
// both do top-level work keyed off process.env at import time. Vitest gives
// this file its own module registry (isolate: true is the default), so the
// dynamic imports below are fresh regardless of what other test files did —
// but process.env itself is real Node global state shared by the whole
// worker process, so every key this file touches is saved up front and
// restored in afterAll (see src/db/__tests__/clientMemoryMode.test.ts for
// the same pattern).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MUTATED_ENV_KEYS = [
  'DB_DRIVER', 'AUTH_MODE', 'SESSION_SECRET', 'DATA_DIR', 'PGLITE_PATH',
] as const;
const savedEnv: Partial<Record<(typeof MUTATED_ENV_KEYS)[number], string>> = {};
for (const key of MUTATED_ENV_KEYS) {
  const val = process.env[key];
  if (val !== undefined) savedEnv[key] = val;
}

process.env.DB_DRIVER = 'pglite';
process.env.AUTH_MODE = 'none';
process.env.SESSION_SECRET = 'x'.repeat(32);

let tmp: string;
let app: FastifyInstance;

const GOOD_PASSWORD = 'correct-horse-battery-staple';
const OTHER_PASSWORD = 'another-strong-passphrase-2026';

describe('/api/security (pglite, AUTH_MODE=none)', () => {
  beforeAll(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'athena-sec-'));
    process.env.DATA_DIR = tmp;
    process.env.PGLITE_PATH = path.join(tmp, 'athena.db');

    const { runMigrations } = await import('../src/db/migrate.js');
    const { ensureLocalUser } = await import('../src/domain/auth/localUser.js');
    const { build } = await import('../src/buildServer.js');

    await runMigrations();
    await ensureLocalUser();
    app = await build({ logger: false });
  });

  afterAll(async () => {
    await app?.close();
    await rm(tmp, { recursive: true, force: true });
    for (const key of MUTATED_ENV_KEYS) {
      const val = savedEnv[key];
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('GET /api/security reports the initial (unencrypted) state', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/security' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ driver: 'pglite', encrypted: false, pendingDisable: false });
  });

  it('rejects enable with a password under 8 characters', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/security/enable', payload: { password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('enables encryption with a valid password', async () => {
    const { hasSnapshot, readMarker } = await import('../src/db/snapshotStore.js');

    const res = await app.inject({
      method: 'POST', url: '/api/security/enable', payload: { password: GOOD_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    expect(await hasSnapshot(tmp)).toBe(true);
    expect(await readMarker(tmp)).toBe('encrypted');
  });

  it('rejects enabling again once already encrypted', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/security/enable', payload: { password: GOOD_PASSWORD },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/security now reflects the encrypted state', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/security' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ driver: 'pglite', encrypted: true, pendingDisable: false });
  });

  it('rejects disable with the wrong password', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/security/disable', payload: { password: 'totally-wrong-password' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'wrong password' });
  });

  it('changes the password and re-encrypts under the new one', async () => {
    const { readSnapshot } = await import('../src/db/snapshotStore.js');
    const { decryptBuffer, EnvelopeDecryptError } = await import('../src/lib/binaryEnvelope.js');

    const res = await app.inject({
      method: 'POST', url: '/api/security/change',
      payload: { oldPassword: GOOD_PASSWORD, newPassword: OTHER_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const snapshot = await readSnapshot(tmp);
    // Decrypts cleanly under the new password...
    expect(() => decryptBuffer(snapshot, OTHER_PASSWORD)).not.toThrow();
    // ...and no longer under the old one.
    expect(() => decryptBuffer(snapshot, GOOD_PASSWORD)).toThrow(EnvelopeDecryptError);
  });

  it('removes the .bak file after a password change (old password must not stay unlockable)', async () => {
    const { backupSnapshotPath } = await import('../src/db/snapshotStore.js');
    // writeSnapshot's rotation would otherwise leave the pre-change
    // ciphertext — still decryptable under GOOD_PASSWORD — sitting in .bak.
    expect(existsSync(backupSnapshotPath(tmp))).toBe(false);
  });

  it('rolls back to the previous password when the pipeline silently fails during change', async () => {
    const { _setPipelineForTests } = await import('../src/db/snapshotScheduler.js');
    const { readSnapshot } = await import('../src/db/snapshotStore.js');
    const { decryptBuffer, EnvelopeDecryptError } = await import('../src/lib/binaryEnvelope.js');

    // snapshotNow() never rejects — a real pipeline failure (disk full, dump
    // error) is only ever logged and swallowed. Simulate exactly that with a
    // no-op pipeline: the on-disk snapshot stays encrypted under
    // OTHER_PASSWORD (the current password, set by the previous test)
    // instead of being rewritten under the attempted new password.
    _setPipelineForTests(async () => { /* simulate a silently-failing pipeline: write nothing */ });
    try {
      const res = await app.inject({
        method: 'POST', url: '/api/security/change',
        payload: { oldPassword: OTHER_PASSWORD, newPassword: 'attempted-new-password-2026' },
      });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({
        error: 'password change failed — previous password still applies',
      });

      const snapshot = await readSnapshot(tmp);
      // The previous (current) password still works...
      expect(() => decryptBuffer(snapshot, OTHER_PASSWORD)).not.toThrow();
      // ...and the attempted new password was never actually applied.
      expect(() => decryptBuffer(snapshot, 'attempted-new-password-2026')).toThrow(EnvelopeDecryptError);
    } finally {
      _setPipelineForTests(null);
    }
  });

  it('rejects change with the wrong old password', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/security/change',
      payload: { oldPassword: 'nope-not-it', newPassword: 'irrelevant-new-password' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'wrong password' });
  });

  it('disables with the correct (current) password, marking disable-pending', async () => {
    const { readMarker } = await import('../src/db/snapshotStore.js');

    const res = await app.inject({
      method: 'POST', url: '/api/security/disable', payload: { password: OTHER_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, restartRequired: true });
    expect(await readMarker(tmp)).toBe('disable-pending');
  });

  it('GET /api/security reflects the pending-disable state', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/security' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ driver: 'pglite', encrypted: false, pendingDisable: true });
  });

  it('rejects enabling while a disable is pending, leaving athena.db.enc untouched', async () => {
    const { snapshotPath } = await import('../src/db/snapshotStore.js');
    const before = await readFile(snapshotPath(tmp));

    const res = await app.inject({
      method: 'POST', url: '/api/security/enable', payload: { password: 'brand-new-attempt-password-2026' },
    });
    expect(res.statusCode).toBe(400);

    // The pre-existing 'disable-pending' marker must fall into the same
    // rejection as an already-'encrypted' marker — falling through to the
    // failure-cleanup path would call clearEncryption(), destroying the
    // only remaining on-disk copy of the data instead of just failing.
    const after = await readFile(snapshotPath(tmp));
    expect(after.equals(before)).toBe(true);
    const { readMarker } = await import('../src/db/snapshotStore.js');
    expect(await readMarker(tmp)).toBe('disable-pending');
  });

  it('rejects disable/change once no longer in the encrypted state', async () => {
    const disable = await app.inject({
      method: 'POST', url: '/api/security/disable', payload: { password: OTHER_PASSWORD },
    });
    expect(disable.statusCode).toBe(400);

    const change = await app.inject({
      method: 'POST', url: '/api/security/change',
      payload: { oldPassword: OTHER_PASSWORD, newPassword: 'yet-another-password' },
    });
    expect(change.statusCode).toBe(400);
  });
});
