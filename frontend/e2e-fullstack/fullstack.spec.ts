import { test, expect, type Page } from '@playwright/test';
import { createAccount, dismissWelcomeTour } from '../e2e-shared/helpers';

// True end-to-end happy path against the real backend (see
// playwright.fullstack.config.ts): onboarding registers the first user,
// session login works from a cold browser context, and data written through
// the UI lands in the database and survives a fresh session.
//
// Serial by design — each test builds on the previous one's state (the
// registered user, then the created account). The suite assumes a fresh
// database (in-memory pglite by default; CI provisions a throwaway
// Postgres).

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

test('onboarding: the first user registers and lands on the dashboard', async ({ page }) => {
  await page.goto('/');
  // Unauthenticated + no user in DB → redirected to the onboarding form.
  await expect(page).toHaveURL(/\/login$/);
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  const passwords = page.locator('input[autocomplete="new-password"]');
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL(/\/$/);
  // The welcome tour rendering proves the authenticated dashboard booted
  // against the live API (tips fetch settled, session cookie accepted).
  await dismissWelcomeTour(page);
  await expect(page.getByRole('link', { name: 'Comptes' })).toBeVisible();
});

test('session login from a cold context, then create a bank account', async ({ page }) => {
  // Fresh browser context — no cookie. Protected routes must bounce to /login.
  await page.goto('/accounts');
  await expect(page).toHaveURL(/\/login$/);
  await login(page);
  await createAccount(page, ACCOUNT_NAME, '1234,56');
});

test('created data persists into a fresh session', async ({ page, request }) => {
  const health = await request.get('/health');
  expect(health.ok()).toBeTruthy();
  expect((await health.json()).ok).toBe(true);

  await login(page);
  await page.goto('/accounts');
  await expect(page.getByText(ACCOUNT_NAME)).toBeVisible();
});
