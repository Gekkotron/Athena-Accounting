import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
