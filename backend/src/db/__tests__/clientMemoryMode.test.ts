// Verifies the fully in-memory PGlite boot path used by the desktop
// encryption-at-rest flow: when the entry process has already loaded (and
// decrypted) a snapshot into `globalThis.__athenaLoadDataDir`, client.ts must
// hand that Blob straight to `PGlite.create({ loadDataDir })` instead of
// pointing PGlite at a plaintext `dataDir` on disk.
//
// Env must be set BEFORE the dynamic import of '../client.js' — client.ts
// does a top-level-await build keyed off `env` (read at import time), and
// vitest gives this file its own worker/module registry, so the singleton
// import here is fresh regardless of what other test files did.
import { describe, it, expect, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('client.ts in-memory PGlite handoff', () => {
  let sourceDir: string | undefined;
  let unusedDataDir: string | undefined;

  afterEach(async () => {
    delete (globalThis as Record<string, unknown>).__athenaLoadDataDir;
    if (sourceDir) {
      await rm(sourceDir, { recursive: true, force: true });
      sourceDir = undefined;
    }
    if (unusedDataDir) {
      await rm(unusedDataDir, { recursive: true, force: true });
      unusedDataDir = undefined;
    }
  });

  it('boots from a loadDataDir blob, ignoring PGLITE_PATH, and exposes getPglite()/dbDriver', async () => {
    sourceDir = await mkdtemp(path.join(tmpdir(), 'athena-client-memory-src-'));
    unusedDataDir = await mkdtemp(path.join(tmpdir(), 'athena-client-memory-unused-'));

    const source = new PGlite(sourceDir);
    await source.exec('CREATE TABLE t (x int);');
    await source.exec('INSERT INTO t (x) VALUES (42);');
    const blob = await source.dumpDataDir();
    await source.close();

    (globalThis as Record<string, unknown>).__athenaLoadDataDir = blob;

    process.env.DB_DRIVER = 'pglite';
    // Deliberately set alongside the loadDataDir blob: buildPglite() must
    // prefer the in-memory blob and never touch this (empty) directory.
    process.env.PGLITE_PATH = unusedDataDir;
    process.env.SESSION_SECRET = 'a'.repeat(32);

    const { pool, getPglite, dbDriver } = await import('../client.js');

    expect(dbDriver).toBe('pglite');
    expect(getPglite()).not.toBeNull();

    const { rows } = await pool.query<{ x: number }>('SELECT x FROM t');
    expect(rows).toEqual([{ x: 42 }]);
  });
});
