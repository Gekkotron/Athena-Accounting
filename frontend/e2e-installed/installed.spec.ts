import { test, expect } from '@playwright/test';
import { createAccount, dismissWelcomeTour } from '../e2e-shared/helpers';

// Installed-app smoke (Layer 2): the target is the packaged desktop app
// launched from the real installer artifact (see
// desktop/scripts/smoke-installed.{sh,ps1}). Desktop builds run with
// AUTH_MODE=none and DB_DRIVER=pglite, so there is no login flow — every
// request authenticates as the seeded local user.
//
// Keep this suite tiny: it runs inside the release workflow on all three
// OS runners. Its job is packaging/runtime regressions (shell↔sidecar spawn
// contract, bundled node_modules, WebView runtime), not feature coverage —
// that's the full-stack suite's job in ci.yml.

test('health reports ok, the pglite driver, and the expected version', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.driver).toBe('pglite');
  const expected = process.env.ATHENA_EXPECT_VERSION;
  if (expected) expect(body.version).toBe(expected);
});

test('the SPA loads and authenticates as the local user (no login page)', async ({ page }) => {
  await page.goto('/');
  await dismissWelcomeTour(page);
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('link', { name: 'Comptes' })).toBeVisible();
});

test('an account created through the UI persists across a reload', async ({ page }) => {
  // Unique name: the app's data dir persists for the lifetime of the
  // installed instance, so a fixed name could collide with a previous run.
  const name = `Compte smoke ${Date.now()}`;
  await createAccount(page, name, '100,00');
  await page.reload();
  await expect(page.getByText(name)).toBeVisible();
});
