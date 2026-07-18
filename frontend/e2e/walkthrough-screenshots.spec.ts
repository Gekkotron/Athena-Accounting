import { test, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Captures the PNGs that back docs/users/walkthroughs/*.md.
// Runs against the demo build (VITE_DEMO=1) so no backend is required.
// Set WALKTHROUGH_SHOTS=1 to opt in; the default suite (demo.spec.ts) skips it.

const SHOULD_RUN = process.env.WALKTHROUGH_SHOTS === '1';

const OUT_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'docs',
  'users',
  'walkthroughs',
  'img',
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

  test.use({ locale: 'fr-FR' });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Force i18next to French — it persists language in localStorage.
    await page.addInitScript(() => {
      try { localStorage.setItem('i18nextLng', 'fr'); } catch { /* noop */ }
    });
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
