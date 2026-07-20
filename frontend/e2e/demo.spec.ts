import { test, expect, type Page } from '@playwright/test';

// Smoke coverage for the browser-only demo build. Focus on the guarantees
// unit + component tests can't make: the built bundle runs end-to-end in a
// real browser, no request escapes to `/api/*`, the reset flow flushes
// local edits, and the "not available in demo" modal replaces raw errors.
//
// UI navigation via clicks depends on i18n labels + Layout structure that
// evolve; where possible we assert against ARIA roles/URLs the router
// controls to keep this suite resistant to markup churn.

async function dismissWelcomeTour(page: Page): Promise<void> {
  // The dashboard tour renders on '/' for anyone who hasn't dismissed it;
  // in demo mode /api/tips/dismissed isn't stubbed so it always appears
  // once the TipsProvider's initial fetch settles (~one tick). Its step 0
  // is titled "Solde global" (fr) / "Total balance" (en). Wait for the
  // dialog, press Escape, then wait for it to detach so subsequent
  // clicks aren't intercepted by the backdrop.
  const tour = page.getByRole('dialog', { name: /Solde global|Total balance/i });
  await tour.waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.press('Escape');
  await tour.waitFor({ state: 'hidden' });
}

test.describe('browser-only demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.clear(); } catch { /* private mode */ }
    });
  });

  test('landing page shows the demo banner', async ({ page }) => {
    await page.goto('/');
    const banner = page.getByRole('region', { name: 'Bandeau démo' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Démo');
    await expect(banner).toContainText('vos actions sont enregistrées');
  });

  test('no requests leak to /api/*', async ({ page }) => {
    const apiHits: string[] = [];
    page.on('request', (req) => {
      try {
        const url = new URL(req.url());
        if (url.pathname.startsWith('/api/')) apiHits.push(req.url());
      } catch { /* opaque URLs (data:, blob:) — ignore */ }
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.goto('/transactions');
    await page.waitForLoadState('networkidle');
    expect(apiHits, `unexpected /api/* calls: ${apiHits.join(', ')}`).toEqual([]);
  });

  test('reset button confirms and clears persisted edits', async ({ page }) => {
    await page.goto('/');
    await dismissWelcomeTour(page);
    await page.waitForLoadState('networkidle');

    // Poison the persisted state so we can prove reset wipes it. The
    // adapter's own writes may or may not flush before we check, but a
    // manually-set sentinel is a deterministic marker.
    await page.evaluate(() => {
      localStorage.setItem(
        'athena_demo_state',
        JSON.stringify({ v: 1, sentinel: 'poisoned' }),
      );
    });
    expect(await page.evaluate(() => localStorage.getItem('athena_demo_state')))
      .toContain('poisoned');

    await page.getByRole('button', { name: 'Réinitialiser la démo' }).click();
    await expect(page.getByText('Démo réinitialisée.')).toBeVisible();

    // The reset handler wipes the key; a subsequent read may re-populate it
    // via freshSeed(), but it must no longer contain the sentinel.
    const after = await page.evaluate(() => localStorage.getItem('athena_demo_state'));
    expect(after ?? '').not.toContain('poisoned');
  });

  test('DemoUnavailableModal renders when the app dispatches the event', async ({ page }) => {
    // The modal listens for a `demo:show-unavailable` CustomEvent; the
    // "raw stack trace instead of modal" regression is exactly this event
    // path not being wired. Firing it from the page is the most stable
    // integration check available without deep-linking into flows whose
    // labels shift with i18n edits.
    await page.goto('/');
    await dismissWelcomeTour(page);
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('demo:show-unavailable', { detail: { feature: 'Imports PDF' } }),
      );
    });
    const dialog = page.locator('div[role="dialog"]', {
      hasText: 'Non disponible dans la démo',
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Imports PDF');
  });
});
