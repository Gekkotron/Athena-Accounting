import { defineConfig, devices } from '@playwright/test';

// Layer 2 installed-app smoke: drives an ALREADY-RUNNING desktop app — the
// real installer artifact (.dmg/.AppImage/.exe), launched the way a user
// would — through the sidecar's HTTP surface. Launch + port discovery live
// in desktop/scripts/smoke-installed.{sh,ps1}; this config only needs the
// resulting URL:
//
//   ATHENA_SMOKE_URL=http://127.0.0.1:<port>   (required — from .mcp-port)
//   ATHENA_EXPECT_VERSION=1.2.3                (optional — asserted on /health)
//
// No webServer: the app under test is external and must NOT be managed by
// Playwright (killing it is the smoke script's job).

const BASE = process.env.ATHENA_SMOKE_URL;
if (!BASE) {
  throw new Error(
    'ATHENA_SMOKE_URL must point at a running installed app — see desktop/scripts/smoke-installed.sh',
  );
}

export default defineConfig({
  testDir: './e2e-installed',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // No retries: the app under test keeps its state between attempts, so a
  // retry wouldn't start from the same conditions anyway.
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE,
    // The specs assert French labels; detection falls back to navigator.
    locale: 'fr-FR',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
