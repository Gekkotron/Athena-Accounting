// Verifies the fully in-memory PGlite boot path used by the desktop
// encryption-at-rest flow: when the entry process has already loaded (and
// decrypted) a snapshot into `globalThis.__athenaLoadDataDir`, client.ts must
// hand that Blob straight to `PGlite.create({ loadDataDir })` instead of
// pointing PGlite at a plaintext `dataDir` on disk.
//
// Env must be set BEFORE the dynamic import of '../client.js' — client.ts
// does a top-level-await build keyed off `env` (read at import time). Vitest
// gives this file its own worker/module registry, but that registry isn't
// untouched by the time this test runs: `tests/setup.ts` (a shared
// setupFile) already imports migrate.js -> client.js under the ambient
// DB_DRIVER=pglite before this file's own code runs, so client.js's
// top-level-await `db`/`pool`/`dbDriver` singleton is already built from
// that earlier (unrelated) boot. A plain `await import('../client.js')`
// below would just return that cached instance — built before
// `__athenaLoadDataDir`/PGLITE_PATH were set — not a fresh one reflecting
// this test's overrides. `vi.resetModules()` clears the registry so the
// import below re-runs client.js's (and env.js's) top-level code against
// the current process.env, the same escape hatch `refreshEnvForTests()`
// (src/env.ts) provides for scalar env reads — this one's needed instead
// because client.ts builds real objects (a Pool/PGlite instance), not just
// scalars, at import time.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MUTATED_ENV_KEYS = ['DB_DRIVER', 'PGLITE_PATH', 'SESSION_SECRET'] as const;

describe('client.ts in-memory PGlite handoff', () => {
  let sourceDir: string | undefined;
  let unusedDataDir: string | undefined;
  // vitest runs this suite `fileParallelism: false`, i.e. all test files
  // share one worker process — `process.env` is real Node global state, not
  // reset per file. This test intentionally mutates DB_DRIVER/PGLITE_PATH/
  // SESSION_SECRET to drive client.ts's top-level-await build; snapshot the
  // pre-test values and restore them exactly afterward so later test files
  // that import env.ts don't inherit this test's overrides.
  let savedEnv: Partial<Record<(typeof MUTATED_ENV_KEYS)[number], string>>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of MUTATED_ENV_KEYS) {
      const val = process.env[key];
      if (val !== undefined) savedEnv[key] = val;
    }
  });

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
    for (const key of MUTATED_ENV_KEYS) {
      const val = savedEnv[key];
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
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

    // Force a fresh client.js (and the env.js it imports) so its top-level
    // build actually observes __athenaLoadDataDir and the overrides above,
    // instead of returning the instance tests/setup.ts already built.
    vi.resetModules();
    const { pool, getPglite, dbDriver } = await import('../client.js');

    expect(dbDriver).toBe('pglite');
    expect(getPglite()).not.toBeNull();

    const { rows } = await pool.query<{ x: number }>('SELECT x FROM t');
    expect(rows).toEqual([{ x: 42 }]);
  });
});
