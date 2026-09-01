import { test, expect, type Page } from '@playwright/test';
import { createAccount } from '../e2e-shared/helpers';

// Shares the fullstack webServer + DB with fullstack.spec.ts. That spec's
// serial "onboarding" test runs first (files are ordered alphabetically and
// fullstack < notifications), so we can assume USER already exists here and
// just log in.
const USERNAME = 'e2e-user';
const PASSWORD = 'athena-e2e-password';
const ACCOUNT_NAME = 'Compte notifications e2e';

test.describe.configure({ mode: 'serial' });

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('big-transaction threshold triggers the bell badge and an inbox row', async ({ page }) => {
  await login(page);
  await createAccount(page, ACCOUNT_NAME);

  // Settings → Notifications → "Grosse transaction" card renders one
  // per-account threshold input per trigger; the bigTransaction card's
  // row is the first match for this account name (accountLow's card
  // renders a second one further down).
  await page.goto('/settings');
  const thresholdInput = page.getByRole('textbox', { name: ACCOUNT_NAME }).first();
  await thresholdInput.fill('500');
  await thresholdInput.press('Tab'); // blur-commits the PATCH, no explicit save button

  // Import a CSV with one -800 transaction on that account — past the
  // 500 threshold.
  await page.goto('/data/imports');
  const csv = Buffer.from(
    'Date;Libellé;Montant\n20/06/2026;VIREMENT LOYER APPART;-800,00\n',
    'utf-8',
  );
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({ name: 'big-tx.csv', mimeType: 'text/csv', buffer: csv });
  await page.getByLabel('Compte').selectOption({ label: ACCOUNT_NAME });
  await page.getByRole('button', { name: 'Importer' }).first().click();

  const dialog = page.getByRole('dialog', { name: /Prévisualiser/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Importer' }).click();
  await expect(dialog).toBeHidden();

  // The batcher holds the notification for IDLE_MS (2000ms) before emitting
  // the summary; the SSE stream then invalidates the notifications queries.
  // Assert on the truthful outcome (badge appears) rather than sleeping a
  // fixed duration.
  // Layout renders the bell twice (desktop sidebar + mobile top bar,
  // toggled by CSS breakpoint) — :visible picks whichever one the current
  // viewport actually shows.
  await expect(page.locator('[data-testid="notification-badge"]:visible')).toBeVisible({ timeout: 5000 });

  await page.goto('/notifications');
  const row = page.getByTestId('notification-row').first();
  await expect(row).toBeVisible();
  await expect(row.getByText('Grosse transaction')).toBeVisible();
});
