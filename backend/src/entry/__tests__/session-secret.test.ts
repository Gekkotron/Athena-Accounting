import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureSessionSecret, writeSessionSecretFile } from '../session-secret.js';

describe('ensureSessionSecret', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'athena-secret-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('fresh install: no file, no datadir → writes file and returns needsMigration=false', async () => {
    const result = await ensureSessionSecret(dir);
    expect(result.needsMigration).toBe(false);
    expect(result.secret.length).toBeGreaterThanOrEqual(32);
    expect(result.secretPath).toBe(path.join(dir, 'session-secret.bin'));
    expect(existsSync(result.secretPath)).toBe(true);
    const persisted = (await readFile(result.secretPath, 'utf8')).trim();
    expect(persisted).toBe(result.secret);
  });

  it('legacy install: no file, datadir present → returns needsMigration=true and DOES NOT write file', async () => {
    await mkdir(path.join(dir, 'athena.db'), { recursive: true });
    const result = await ensureSessionSecret(dir);
    expect(result.needsMigration).toBe(true);
    expect(result.secret.length).toBeGreaterThanOrEqual(32);
    expect(existsSync(result.secretPath)).toBe(false);
  });

  it('existing file: reads and returns the same content, no migration flag', async () => {
    const canned = 'a'.repeat(64);
    await writeFile(path.join(dir, 'session-secret.bin'), canned + '\n');
    const result = await ensureSessionSecret(dir);
    expect(result.secret).toBe(canned);
    expect(result.needsMigration).toBe(false);
  });

  it('two fresh calls back-to-back after a first fresh-install boot are idempotent', async () => {
    const first = await ensureSessionSecret(dir);
    const second = await ensureSessionSecret(dir);
    expect(second.secret).toBe(first.secret);
    expect(second.needsMigration).toBe(false);
  });

  it('two fresh calls back-to-back generate distinct secrets across separate temp dirs', async () => {
    const dir2 = await mkdtemp(path.join(tmpdir(), 'athena-secret-'));
    try {
      const first = await ensureSessionSecret(dir);
      const second = await ensureSessionSecret(dir2);
      expect(first.secret).not.toBe(second.secret);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });

  it('corrupted file (too short) throws with an actionable message', async () => {
    await writeFile(path.join(dir, 'session-secret.bin'), 'too-short');
    await expect(ensureSessionSecret(dir)).rejects.toThrow(/corrupted/i);
  });

  it('reading a session-secret.bin with trailing whitespace strips it', async () => {
    const canned = 'b'.repeat(48);
    await writeFile(path.join(dir, 'session-secret.bin'), `${canned}   \n\n`);
    const result = await ensureSessionSecret(dir);
    expect(result.secret).toBe(canned);
  });
});

describe('writeSessionSecretFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'athena-secret-write-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the secret with a trailing newline and 0o600 mode on POSIX', async () => {
    const secretPath = path.join(dir, 'session-secret.bin');
    await writeSessionSecretFile(secretPath, 'c'.repeat(64));
    const persisted = await readFile(secretPath, 'utf8');
    expect(persisted).toBe('c'.repeat(64) + '\n');
    if (process.platform !== 'win32') {
      const st = await stat(secretPath);
      // Owner rw only — 0o600. Mask the file-type bits.
      expect(st.mode & 0o777).toBe(0o600);
    }
  });
});
