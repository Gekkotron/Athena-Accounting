import { test, expect, type Page } from '@playwright/test';
import { createAccount, dismissWelcomeTour } from '../e2e-shared/helpers';

// Golden path for a first-time visitor, against the real backend (see
// playwright.fullstack.config.ts; pglite by default, no Docker needed):
//   onboarding/login -> create account -> import a French CSV ->
//   transactions list -> keyword rule categorizes rows -> dashboard balance.
//
// Self-contained: registers the first user if none exists, otherwise logs in
// as the user fullstack.spec.ts created (files run alphabetically, so that
// spec normally goes first). Uses its own account, category and keyword.

const USERNAME = 'e2e-user';
const PASSWORD = 'athena-e2e-password';
const ACCOUNT_NAME = 'Compte golden path e2e';
const CATEGORY_NAME = 'Courses golden e2e';
const KEYWORD = 'goldenmarket';

const CSV = [
  'Date;Libellé;Montant',
  '02/06/2026;VIR SALAIRE GOLDEN E2E;1 234,56',
  '05/06/2026;CB GOLDENMARKET PARIS;-45,90',
  '12/06/2026;CB GOLDENMARKET LYON;-32,10',
  '15/06/2026;PRLV LOYER GOLDEN E2E;-600,00',
  '',
].join('\n');

test.describe.configure({ mode: 'serial' });

async function loginOrRegister(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  const newPasswords = page.locator('input[autocomplete="new-password"]');
  if ((await newPasswords.count()) === 2) {
    await newPasswords.nth(0).fill(PASSWORD);
    await newPasswords.nth(1).fill(PASSWORD);
    await page.getByRole('button', { name: 'Créer le compte' }).click();
  } else {
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
  }
  await expect(page).toHaveURL(/\/$/);
}

test('import a French CSV into a new account and see the rows listed', async ({ page }) => {
  await loginOrRegister(page);
  await dismissWelcomeTour(page);
  await createAccount(page, ACCOUNT_NAME, '100,00');

  await page.goto('/data/imports');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'golden-path.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV, 'utf-8'),
  });
  await page.getByLabel('Compte').selectOption({ label: ACCOUNT_NAME });
  await page.getByRole('button', { name: 'Importer' }).first().click();

  const dialog = page.getByRole('dialog', { name: /Prévisualiser/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Nouveau')).toHaveCount(4);
  await dialog.getByRole('button', { name: 'Importer' }).click();
  await expect(dialog).toBeHidden();

  // /transactions defaults to another account, so scope the URL to ours.
  const res = await page.request.get('/api/accounts');
  const { accounts } = (await res.json()) as { accounts: Array<{ id: number; name: string }> };
  const account = accounts.find((a) => a.name === ACCOUNT_NAME);
  expect(account, `account ${ACCOUNT_NAME} in /api/accounts`).toBeDefined();
  await page.goto(`/transactions?accountId=${account!.id}`);

  for (const label of [
    'VIR SALAIRE GOLDEN E2E',
    'CB GOLDENMARKET PARIS',
    'CB GOLDENMARKET LYON',
    'PRLV LOYER GOLDEN E2E',
  ]) {
    await expect(page.getByRole('row', { name: new RegExp(label) })).toBeVisible();
  }
});

test('a keyword rule categorizes the matching imported transactions', async ({ page }) => {
  await loginOrRegister(page);
  const created = await page.request.post('/api/categories', {
    data: { name: CATEGORY_NAME, kind: 'expense' },
  });
  expect(
    created.ok() || created.status() === 409,
    `create category status=${created.status()}`,
  ).toBeTruthy();

  // Keep the rules-page tour from intercepting clicks.
  await page.request.post('/api/tips/dismiss', { data: { id: 'tour:rules-list' } });
  await page.goto('/rules/list');
  await page.getByLabel(/Mot-clé/).fill(KEYWORD);
  await page.getByLabel('Catégorie').first().selectOption({ label: CATEGORY_NAME });
  await page.getByRole('button', { name: 'Ajouter la règle' }).click();
  await expect(page.getByText(KEYWORD).first()).toBeVisible();

  // Apply the new rule to the already-imported history.
  await page.getByRole('button', { name: /Recatégoriser l'historique/i }).click();
  const confirm = page.getByRole('dialog').filter({ hasText: /Recatégoriser tout/i });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: /Recatégoriser/i }).click();
  await expect(confirm).toBeHidden();

  // Assert categorization via the API — the transactions-row DOM renders a
  // category <select> whose options list every category, so row-text matches
  // would be false positives. The list endpoint returns categoryId only; we
  // map it to the name through /api/categories.
  const accountsRes = await page.request.get('/api/accounts');
  const { accounts } = (await accountsRes.json()) as {
    accounts: Array<{ id: number; name: string }>;
  };
  const account = accounts.find((a) => a.name === ACCOUNT_NAME);
  expect(account, `account ${ACCOUNT_NAME} in /api/accounts`).toBeDefined();

  const catsRes = await page.request.get('/api/categories');
  expect(catsRes.ok(), `categories status=${catsRes.status()}`).toBeTruthy();
  const { categories: cats } = (await catsRes.json()) as {
    categories: Array<{ id: number; name: string }>;
  };
  const category = cats.find((c) => c.name === CATEGORY_NAME);
  expect(category, `category ${CATEGORY_NAME} in /api/categories`).toBeDefined();

  const txRes = await page.request.get(`/api/transactions?accountId=${account!.id}&limit=50`);
  expect(txRes.ok(), `transactions status=${txRes.status()}`).toBeTruthy();
  const { transactions } = (await txRes.json()) as {
    transactions: Array<{ rawLabel: string; categoryId: number | null }>;
  };
  const by = (needle: string) =>
    transactions.find((t) => (t.rawLabel ?? '').toUpperCase().includes(needle));
  expect(
    by('GOLDENMARKET PARIS'),
    `transaction containing GOLDENMARKET PARIS (got ${transactions.length} rows)`,
  ).toBeDefined();
  expect(by('GOLDENMARKET PARIS')?.categoryId).toBe(category!.id);
  expect(by('GOLDENMARKET LYON')?.categoryId).toBe(category!.id);
  expect(by('LOYER')?.categoryId ?? null).not.toBe(category!.id);
});

test('the dashboard shows a non-zero balance once data is imported', async ({ page }) => {
  await loginOrRegister(page);
  await dismissWelcomeTour(page);
  await page.goto('/');

  const hero = page.locator('section').filter({ hasText: /Solde net|Disponible/ }).first();
  await expect(hero).toContainText(/\d/);
  const heroAmount = hero.locator('.display').first();
  await expect(heroAmount).not.toHaveText('—');
  await expect(heroAmount).not.toHaveText(/^-?0,00\s*€$/);
});
