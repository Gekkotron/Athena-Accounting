import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Full-stack E2E: the real Fastify backend serves both /api/* and the built
// SPA (SERVE_STATIC + STATIC_ROOT), and the suite in ./e2e-fullstack drives
// it in a real browser — session auth, migrations, DB writes included.
// Contrast with playwright.config.ts, which only covers the browser-only
// demo build (no backend at all).
//
// Database — two modes:
//  - default: DB_DRIVER=pglite with an in-memory database. No Docker, no
//    Postgres, state wiped on every boot — runs on any laptop with backend
//    deps installed (`cd backend && npm ci`).
//  - E2E_DATABASE_URL=postgres://…: flips the backend to the node-postgres
//    driver the LAN deployment uses (CI does this via a service container).
//    The target database must be FRESH and disposable: the suite registers
//    a user and writes data, and the onboarding test assumes no user exists.
//
// E2E_SKIP_BUILD=1 skips the frontend build inside webServer — CI builds
// dist/ as its own step; locally the default command rebuilds it first.

const PORT = 4318;
const DB_URL = process.env.E2E_DATABASE_URL;
const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './e2e-fullstack',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // The specs assert the French labels; language detection falls back to
    // navigator (src/i18n/index.ts), so pin a French browser locale.
    locale: 'fr-FR',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  webServer: {
    command: [
      process.env.E2E_SKIP_BUILD ? '' : 'npm run build && ',
      'mkdir -p test-results/e2e-data && ',
      'cd ../backend && npx tsx src/entry/server.ts',
    ].join(''),
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: 'production',
      DB_DRIVER: DB_URL ? 'postgres' : 'pglite',
      ...(DB_URL ? { DATABASE_URL: DB_URL } : {}),
      AUTH_MODE: 'session',
      // Only ever protects a disposable test database — not a secret.
      SESSION_SECRET: 'athena-fullstack-e2e-session-secret-0123456789',
      SERVE_STATIC: 'true',
      STATIC_ROOT: path.resolve(HERE, 'dist'),
      DATA_DIR: path.resolve(HERE, 'test-results', 'e2e-data'),
      BANK_SYNC_AUTO: 'false',
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
