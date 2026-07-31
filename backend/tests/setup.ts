// Global test setup — runs before any test file is loaded (via vitest
// `setupFiles`). Handles the driver-matrix hookup for the DB-gated suite:
//
//   - `DB_DRIVER=postgres` (default): docker-compose.test.yml sets RUN_DB_TESTS=1
//     and DATABASE_URL for us; we do nothing here.
//   - `DB_DRIVER=pglite`: no external DB needed. We auto-enable RUN_DB_TESTS,
//     seed a placeholder DATABASE_URL/SESSION_SECRET so `env.ts` parses, and
//     apply migrations against the embedded PGlite instance once per worker.

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
