import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    passWithNoTests: true,
    setupFiles: ['./src/test/setup.ts'],
    // Playwright specs live in `./e2e/*.spec.ts` — Vitest's default glob
    // would pick them up and fail because they import from
    // `@playwright/test`, which is not a Vitest runner.
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-demo/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      // Include every source file in the report, even those no test touches,
      // so the number reflects the whole codebase (not just executed files).
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',
        'src/**/__tests__/**',
      ],
    },
  },
});
