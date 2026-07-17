// Global test setup — runs before any test file is loaded (via vitest
// `setupFiles`). Handles the driver-matrix hookup for the DB-gated suite:
//
//   - `DB_DRIVER=postgres` (default): docker-compose.test.yml sets RUN_DB_TESTS=1
//     and DATABASE_URL for us; we do nothing here.
//   - `DB_DRIVER=pglite`: no external DB needed. We auto-enable RUN_DB_TESTS,
//     seed a placeholder DATABASE_URL/SESSION_SECRET so `env.ts` parses, and
//     apply migrations against the embedded PGlite instance once per worker.

if (process.env.DB_DRIVER === 'pglite') {
  // env.ts requires SESSION_SECRET >=32 chars regardless of driver — supply a
  // placeholder so unit tests that don't touch the DB still boot cleanly.
  process.env.SESSION_SECRET =
    process.env.SESSION_SECRET ??
    'pglite-test-session-secret-not-a-real-secret-0123456789';

  // Apply migrations only when the DB-gated suite is opted into, matching
  // the docker/Postgres path (docker-compose.test.yml sets RUN_DB_TESTS=1).
  if (process.env.RUN_DB_TESTS) {
    const { runMigrations } = await import('../src/db/migrate.js');
    await runMigrations();
  }
}
