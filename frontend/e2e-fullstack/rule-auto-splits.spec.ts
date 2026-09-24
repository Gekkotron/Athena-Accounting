import { test, expect, type Page } from '@playwright/test';

// Rule-driven auto-splits (spec:
// docs/superpowers/specs/2026-09-16-rule-auto-splits-design.md). Runs
// after fullstack.spec.ts (files sort alphabetically, fullstack <
// rule-auto-splits) so the `e2e-user` account and its account
// "Compte courant e2e" already exist — we log in and pick up where
// that suite left off.
//
// Flow:
//   1. Create three categories + a split-mode rule Amazon → 60% A / 40% B via the UI.
//   2. Import a CSV with a matching Amazon transaction.
//   3. Open the transaction in the modal, confirm two split rows appear
//      with the "Automatique" tag on the section title.
//   4. Manually edit one split's amount (which stamps splits_source='manual'
//      via the existing PUT flow), save.
//   5. Re-run "Recatégoriser l'historique" and confirm the manually-tuned
//      splits are preserved (splits_source='manual' branch of the engine).

const USERNAME = 'e2e-user';
const PASSWORD = 'athena-e2e-password';
const ACCOUNT_NAME = 'Compte courant e2e';

test.describe.configure({ mode: 'serial' });

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function createCategory(page: Page, name: string): Promise<void> {
  const res = await page.request.post('/api/categories', {
    data: { name, kind: 'expense' },
  });
  // 409 is fine on a Playwright retry — the suite shares one DB and the
  // first attempt may have already inserted the row before failing later.
  expect(
    res.ok() || res.status() === 409,
    `create category ${name} status=${res.status()}`,
  ).toBeTruthy();
}

test('create a split-mode rule via the Rules page UI', async ({ page }) => {
  await login(page);
  await createCategory(page, 'Livres e2e');
  await createCategory(page, 'Electro e2e');
  await createCategory(page, 'Retail e2e');

  await page.goto('/rules/list');
  // Fill the quick-add form. The keyword field is text; category, sign,
  // and mode are selects; priority is inputMode="numeric".
  await page.getByLabel(/Mot-clé/).fill('amazon-splits-e2e');
  // "Catégorie" select picks the primary display category.
  await page.getByLabel('Catégorie').first().selectOption({ label: 'Retail e2e' });
  // Toggle split mode on — the toggle checkbox has the "Ventilation
  // multi-catégories" label text.
  await page.getByRole('checkbox', { name: /ventilation multi-catégories/i }).check();
  // Two rows seed empty; pick two categories + assign 60 / 40.
  const categoryDropdowns = page.getByRole('combobox', { name: /Catégorie$/ });
  // The first two combobox matches inside the editor are the row pickers.
  // (The top-of-form "Catégorie" select is included first, so we take
  // the last two.)
  const total = await categoryDropdowns.count();
  expect(total).toBeGreaterThanOrEqual(3);
  await categoryDropdowns.nth(total - 2).selectOption({ label: 'Livres e2e' });
  await categoryDropdowns.nth(total - 1).selectOption({ label: 'Electro e2e' });
  const percentInputs = page.getByRole('spinbutton', { name: /^%$/ });
  await percentInputs.nth(0).fill('60');
  await percentInputs.nth(1).fill('40');
  // Sum indicator flips to sage — submit enables.
  await page.getByRole('button', { name: 'Ajouter la règle' }).click();
  // Chip lands in the grouped view under "Retail e2e" (default view).
  await expect(page.getByText('amazon-splits-e2e').first()).toBeVisible();
});

test('import a CSV, open the matching transaction, confirm auto-splits render with the Automatique tag', async ({ page }) => {
  await login(page);
  await page.goto('/data/imports');
  const csv = Buffer.from(
    'Date;Libellé;Montant\n21/06/2026;AMAZON-SPLITS-E2E FR;-100,00\n',
    'utf-8',
  );
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({ name: 'amazon-e2e.csv', mimeType: 'text/csv', buffer: csv });
  await page.getByLabel('Compte').selectOption({ label: ACCOUNT_NAME });
  await page.getByRole('button', { name: 'Importer' }).first().click();

  const dialog = page.getByRole('dialog', { name: /Prévisualiser/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Importer' }).click();
  await expect(dialog).toBeHidden();

  // Jump to Transactions, open the row via its "Modifier" button — the
  // row's label text isn't itself a click target; the edit modal is
  // opened by the pencil button in the last cell.
  await page.goto('/transactions');
  const row = page.getByRole('row', { name: /AMAZON-SPLITS-E2E FR/ });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Modifier' }).click();

  // Tour dialogs on this page also carry role=dialog — pick the edit
  // modal by its unique heading text so `.last()` doesn't grab the tour.
  const modal = page.getByRole('dialog').filter({ hasText: 'Modifier la transaction' });
  await expect(modal.getByText('Ventilation par catégorie')).toBeVisible();
  // Auto tag renders next to the section title.
  await expect(modal.getByText('Automatique').first()).toBeVisible();
  // Two split rows, cent-perfect: -60.00 + -40.00 = -100.00.
  const splitAmountInputs = modal.locator('input.font-mono.w-28');
  await expect(splitAmountInputs).toHaveCount(2);
  const firstAmount = await splitAmountInputs.nth(0).inputValue();
  const secondAmount = await splitAmountInputs.nth(1).inputValue();
  const sum = Number(firstAmount) + Number(secondAmount);
  expect(sum).toBeCloseTo(100.0, 2);
});

test('editing one split flips splits_source to manual and preserves on re-categorize', async ({ page }) => {
  await login(page);
  await page.goto('/transactions');
  await page.getByRole('row', { name: /AMAZON-SPLITS-E2E FR/ }).getByRole('button', { name: 'Modifier' }).click();
  const modal = page.getByRole('dialog').filter({ hasText: 'Modifier la transaction' });

  // Fill both rows explicitly (Playwright's .fill fires a single input
  // event, so relying on the sibling-rebalance react-onChange chain is
  // fragile — write the final 30/70 shape ourselves).
  const splitAmountInputs = modal.locator('input.font-mono.w-28');
  await splitAmountInputs.nth(0).fill('30.00');
  await splitAmountInputs.nth(1).fill('70.00');
  await modal.getByRole('button', { name: /Enregistrer/i }).click();
  await expect(modal).toBeHidden();

  // Run recategorize with the safe default (preserveManual=true, which
  // matters here only for the non-splits branch — splits_source='manual'
  // is preserved unconditionally).
  await page.goto('/rules/list');
  // The rules-list page auto-starts a tour whose floating dialog sits
  // over the Recatégoriser button — Escape closes it.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Recatégoriser l'historique/i }).click();
  const confirm = page.getByRole('dialog', { name: /Recatégoriser tout/i });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: /Recatégoriser/i }).click();
  await expect(confirm).toBeHidden();

  // Reopen the transaction; the user's 30/70 split must survive.
  await page.goto('/transactions');
  await page.getByRole('row', { name: /AMAZON-SPLITS-E2E FR/ }).getByRole('button', { name: 'Modifier' }).click();
  const modal2 = page.getByRole('dialog').filter({ hasText: 'Modifier la transaction' });
  const preservedAmounts = modal2.locator('input.font-mono.w-28');
  await expect(preservedAmounts).toHaveCount(2);
  const first = Number(await preservedAmounts.nth(0).inputValue());
  expect(first).toBeCloseTo(30.0, 2);
  // The Automatique tag is gone — splits_source is 'manual' now.
  await expect(modal2.getByText('Automatique')).toHaveCount(0);
});
