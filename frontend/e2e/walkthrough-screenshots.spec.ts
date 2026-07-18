import { test, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Captures the PNGs that back the walkthrough docs.
// Runs against the demo build (VITE_DEMO=1) so no backend is required.
// Set WALKTHROUGH_SHOTS=1 to opt in; the default suite (demo.spec.ts) skips it.
//
// WALKTHROUGH_LANG selects the UI language (`fr` default; `en` supported).
// Output goes to website/static/img/walkthroughs/<lang>/ — the shared,
// bilingual asset tree referenced by both the default-locale docs and the
// i18n/fr mirror.

const SHOULD_RUN = process.env.WALKTHROUGH_SHOTS === '1';
// Real-backend mode: WALKTHROUGH_LOCAL_URL points playwright.config's
// baseURL at a running Athena instance instead of the demo build. When set,
// we also need to log in as the demo user first (WALKTHROUGH_LOCAL_USER /
// WALKTHROUGH_LOCAL_PASS). Credentials are read at run time only — never
// committed.
const LOCAL_MODE = process.env.WALKTHROUGH_LOCAL_URL !== undefined && process.env.WALKTHROUGH_LOCAL_URL !== '';

const RAW_LANG = (process.env.WALKTHROUGH_LANG ?? 'fr').toLowerCase();
const LANG: 'fr' | 'en' = RAW_LANG === 'en' ? 'en' : 'fr';
const PLAYWRIGHT_LOCALE = LANG === 'en' ? 'en-US' : 'fr-FR';

const OUT_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'website',
  'static',
  'img',
  'walkthroughs',
  LANG,
);

async function dismissWelcomeTour(page: Page): Promise<void> {
  const tour = page.getByRole('dialog', { name: /Athena|Bienvenue/i });
  try {
    await tour.waitFor({ state: 'visible', timeout: 3_000 });
    await page.keyboard.press('Escape');
    await tour.waitFor({ state: 'hidden', timeout: 3_000 });
  } catch {
    // No tour — the localStorage may already have marked it dismissed.
  }
}

async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
}

test.describe('walkthrough screenshots', () => {
  test.skip(!SHOULD_RUN, 'set WALKTHROUGH_SHOTS=1 to regenerate walkthrough PNGs');

  test.use({ locale: PLAYWRIGHT_LOCALE });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Force i18next to the requested language — it persists in localStorage.
    await page.addInitScript((lang) => {
      try { localStorage.setItem('i18nextLng', lang); } catch { /* noop */ }
    }, LANG);
    if (LOCAL_MODE) {
      const user = process.env.WALKTHROUGH_LOCAL_USER;
      const pass = process.env.WALKTHROUGH_LOCAL_PASS;
      if (!user || !pass) {
        throw new Error('WALKTHROUGH_LOCAL_URL is set but WALKTHROUGH_LOCAL_USER / WALKTHROUGH_LOCAL_PASS are missing.');
      }
      await page.goto('/login');
      await page.locator('input[autocomplete="username"]').fill(user);
      await page.locator('input[type="password"]').fill(pass);
      await page.getByRole('button', { name: /Se connecter|Log in/i }).click();
      // Login mutation navigates to '/' on success — wait for it explicitly
      // so downstream page.goto() calls don't race the auth redirect.
      await page.waitForURL('**/', { timeout: 10_000 });
      await dismissWelcomeTour(page);
    }
  });

  test('import-a-statement', async ({ page }) => {
    await page.goto('/');
    await dismissWelcomeTour(page);
    await page.waitForLoadState('networkidle');

    await page.goto('/donnees/imports');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    await shot(page, 'import-01-imports-page');

    await page.goto('/donnees/doublons');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    await shot(page, 'import-02-doublons');

    await page.goto('/comptes');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    await shot(page, 'import-03-comptes-solde');

    // Expand the checkpoints panel on the first account card so the drawer
    // (year accordion + add-form) is visible for the walkthrough shot.
    const firstToggle = page.getByRole('button', { name: /Points de contrôle|Checkpoints/i }).first();
    await firstToggle.click();
    await page.waitForTimeout(400);
    await shot(page, 'import-04-checkpoints');
  });

  test('categorise-transactions', async ({ page }) => {
    await page.goto('/');
    await dismissWelcomeTour(page);
    await page.waitForLoadState('networkidle');

    await page.goto('/transactions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    await shot(page, 'categorise-01-transactions');

    await page.goto('/regles/tri');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    await shot(page, 'categorise-02-tri');

    await page.goto('/regles/liste');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    await shot(page, 'categorise-03-regles-liste');
  });

  test('set-a-budget', async ({ page }) => {
    await page.goto('/');
    await dismissWelcomeTour(page);
    await page.waitForLoadState('networkidle');

    await page.goto('/budgets/plafonds');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    await shot(page, 'budget-01-plafonds');

    await page.goto('/budgets/enveloppes');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    await shot(page, 'budget-02-enveloppes');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    await shot(page, 'budget-03-dashboard-progress');
  });

  test('view-reports', async ({ page }) => {
    await page.goto('/');
    await dismissWelcomeTour(page);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await shot(page, 'reports-01-dashboard');

    // Scroll to reveal charts further down the dashboard.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(500);
    await shot(page, 'reports-02-dashboard-mid');

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await shot(page, 'reports-03-dashboard-bottom');
  });
});
