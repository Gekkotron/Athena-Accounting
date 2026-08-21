import { test, expect, type Page } from '@playwright/test';
import { createAccount } from '../e2e-shared/helpers';

// Shares the fullstack webServer + DB with fullstack.spec.ts. That spec's
// serial "onboarding" test runs first (files are ordered alphabetically and
// fullstack < imports-fuzzy-dedup), so we can assume USER already exists here
// and just log in.
const USERNAME = 'e2e-user';
const PASSWORD = 'athena-e2e-password';
const ACCOUNT_NAME = 'Compte fuzzy dedup e2e';

test.describe.configure({ mode: 'serial' });

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('near-duplicate is flagged as "Probable" and skippable at preview time', async ({ page }) => {
  await login(page);
  await createAccount(page, ACCOUNT_NAME);

  await page.goto('/imports');

  // Upload seed CSV: one CB CARREFOUR row on 2026-06-15 for -25,30 €.
  const seed = Buffer.from(
    'Date;Libellé;Montant\n15/06/2026;CB CARREFOUR MARKET;-25,30\n',
    'utf-8',
  );
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: 'seed.csv', mimeType: 'text/csv', buffer: seed,
  });
  await page.getByLabel('Compte').selectOption({ label: ACCOUNT_NAME });
  await page.getByRole('button', { name: 'Importer' }).first().click();

  // Preview modal opens for the seed — one "Nouveau" row. Confirm to commit.
  const dialog = page.getByRole('dialog', { name: /Prévisualiser/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Nouveau')).toBeVisible();
  await dialog.getByRole('button', { name: 'Importer' }).click();
  await expect(dialog).toBeHidden();

  // Upload a near-duplicate: +1 day, +0.01€, tokenized-similar label.
  const near = Buffer.from(
    'Date;Libellé;Montant\n16/06/2026;PAIEMENT CARREFOUR MARKET REF98;-25,31\n',
    'utf-8',
  );
  await fileInput.setInputFiles({
    name: 'near.csv', mimeType: 'text/csv', buffer: near,
  });
  await page.getByLabel('Compte').selectOption({ label: ACCOUNT_NAME });
  await page.getByRole('button', { name: 'Importer' }).first().click();

  // Second preview: the row is flagged "Probable" with a pre-ticked skip box.
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Probable')).toBeVisible();
  const skipBox = dialog.getByRole('checkbox').first();
  await expect(skipBox).toBeChecked();

  // Un-tick to force the row in, then confirm.
  await skipBox.click();
  await expect(skipBox).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Importer' }).click();
  await expect(dialog).toBeHidden();

  // Both rows are on the transactions page.
  await page.goto('/transactions');
  await expect(page.getByText('CB CARREFOUR MARKET')).toBeVisible();
  await expect(page.getByText('PAIEMENT CARREFOUR MARKET REF98')).toBeVisible();
});
