import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
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
