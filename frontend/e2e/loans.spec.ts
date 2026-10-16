import { test, expect } from '@playwright/test';

// End-to-end through the browser-only demo: the seeded loans render, a new
// loan's payment is computed live by the shared engine, and a what-if early
// repayment reports its savings.
test.describe('loans (demo)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.clear(); } catch { /* private mode */ }
    });
  });

  test('create a loan, then try an early repayment', async ({ page }) => {
    await page.goto('/loans');
    await expect(page.getByRole('button', { name: 'Résidence principale' })).toBeVisible();

    await page.getByRole('button', { name: 'Nouveau prêt' }).click();
    const editor = page.getByRole('dialog', { name: 'Nouveau prêt' });
    await editor.getByLabel('Nom').fill('Voiture');
    await editor.getByLabel('Montant emprunté').fill('18 000');
    await editor.getByLabel('Première échéance').fill('2026-08-05');
    await editor.getByLabel("Taux d'intérêt (% par an)").fill('4,9');
    await editor.getByLabel('Dernière échéance (mois)').fill('2031-07');
    await expect(editor.getByText(/par mois/)).toBeVisible();
    await editor.getByRole('button', { name: 'Enregistrer' }).click();

    const drawer = page.getByRole('dialog', { name: 'Voiture' });
    await expect(drawer.getByText("Tableau d'amortissement")).toBeVisible();
    await drawer.getByRole('button', { name: 'Et si…' }).click();

    const panel = page.getByRole('dialog', { name: 'Et si…' });
    await panel.getByLabel('À partir de (mois)').fill('2028-01');
    await panel.getByLabel('Montant', { exact: true }).fill('5000');
    await panel.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(panel.getByText(/économise/)).toBeVisible();
  });
});
