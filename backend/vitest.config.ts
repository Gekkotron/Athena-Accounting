import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The DB-gated tests share one Postgres and several files do global
    // wipes (`db.delete(users)` in tests/mcp/store.test.ts,
    // `db.delete(accounts)` in tests/accounts-route.test.ts, ...). Running
    // files in parallel makes one file's teardown blow away another file's
    // beforeAll fixtures — FK violations, 400 "compte ou catégorie inconnu".
    // Serialize files; tests inside a file already order themselves.
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      // Include every source file in the report, even those no test touches,
      // so the number reflects the whole codebase (not just executed files).
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/server.ts',
        'src/env.ts',
        'src/db/migrate.ts',
        'src/db/schema.ts',
        'src/db/client.ts',
        'scripts/**',
      ],
    },
  },
});
