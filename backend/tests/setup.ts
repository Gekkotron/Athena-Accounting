// Global test setup — runs before any test file is loaded (via vitest
// `setupFiles`). Handles the driver-matrix hookup for the DB-gated suite:
//
//   - `DB_DRIVER=postgres` (default): docker-compose.test.yml sets RUN_DB_TESTS=1
//     and DATABASE_URL for us; we do nothing here.
//   - `DB_DRIVER=pglite`: no external DB needed. We auto-enable RUN_DB_TESTS,
//     seed a placeholder DATABASE_URL/SESSION_SECRET so `env.ts` parses, and
//     apply migrations against the embedded PGlite instance once per worker.
//
// Per-file env overrides: the `runMigrations()` call below imports the
// migrate -> client -> env chain for every test file (vitest gives each file
// its own module registry, and this setupFile re-runs per file), which means
// `env.ts` has already parsed `process.env` by the time a test file's own
// top-level code runs. A test file that does `process.env.AUTH_MODE = 'none'`
// (or any other `env.*` key) at its top therefore has no effect on its own —
// it must call `refreshEnvForTests()` from `../src/env.js` right after
// mutating `process.env` and before anything that reads `env.*` downstream
// (e.g. before dynamically importing buildServer.js). See
// tests/security-routes.pglite.test.ts. That helper only patches scalar
// values re-read at call time; a module that already built an object off an
// old env value at its OWN import time (like db/client.ts's top-level-await
// db/pool singleton) needs `vi.resetModules()` instead — see
// src/db/__tests__/clientMemoryMode.test.ts.

// env.ts requires SESSION_SECRET >=32 chars regardless of driver — supply a
// placeholder so unit tests that don't touch the DB still boot cleanly on a
// bare `npx vitest run` (no env at all). Real values from the environment
// (CI, docker-compose.test.yml) always win via the ??.
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ??
  'pglite-test-session-secret-not-a-real-secret-0123456789';

// Same spirit for the driver: a bare run has no DATABASE_URL, and env.ts
// hard-requires one under the default postgres driver. Fall back to the
// docker-free embedded driver; an explicit DB_DRIVER or a configured
// DATABASE_URL (CI, docker-compose.test.yml) keeps full precedence.
process.env.DB_DRIVER ??= process.env.DATABASE_URL ? 'postgres' : 'pglite';

if (process.env.DB_DRIVER === 'pglite') {
  // Apply migrations only when the DB-gated suite is opted into, matching
  // the docker/Postgres path (docker-compose.test.yml sets RUN_DB_TESTS=1).
  if (process.env.RUN_DB_TESTS) {
    const { runMigrations } = await import('../src/db/migrate.js');
    await runMigrations();
  }
}
