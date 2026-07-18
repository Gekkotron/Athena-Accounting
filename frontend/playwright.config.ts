import { defineConfig, devices } from '@playwright/test';

// E2E smoke for the browser-only demo build. Boots `vite preview` against
// a fresh `dist-demo/` on port 4173 and runs the specs in `./e2e`.
//
// VITE_DEMO_BASE=/ overrides the gh-pages base (`/Athena-Accounting/demo/`)
// so tests can navigate to `/` directly. VITE_DEMO=1 is set both by the
// `build:demo` script and here explicitly for `vite preview`, which reloads
// the config and needs the same env to serve at the overridden base.

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build:demo && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_DEMO: '1',
      VITE_DEMO_BASE: '/',
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
