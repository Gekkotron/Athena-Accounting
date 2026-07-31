import { expect, type Locator, type Page } from '@playwright/test';

// Helpers shared by the full-stack suite (e2e-fullstack/) and the
// installed-app smoke (e2e-installed/). Both drive the real backend through
// the built SPA, so they meet the same UI: the welcome tour on the
// dashboard, and forms whose labels are visual siblings of their inputs
// (no htmlFor wiring — see the fieldFor helper in the component tests).

// The dashboard tour renders on '/' for any user who hasn't dismissed it.
// Tolerant by design: if the dialog doesn't show up (already dismissed, or
// we never landed on the dashboard) this is a no-op, so callers can invoke
// it unconditionally after any navigation that may end on '/'.
export async function dismissWelcomeTour(page: Page): Promise<void> {
  const tour = page.getByRole('dialog', { name: /Solde global|Total balance/i });
  try {
    await tour.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    return; // never appeared — nothing to dismiss
  }
  await page.keyboard.press('Escape');
  await tour.waitFor({ state: 'hidden' });
}

// Labels in this app are not associated to inputs via htmlFor/id, so
// getByLabel() can't resolve them. Every form renders
// `<div><label>…</label><input/></div>`, so the input is the label's next
// input sibling.
export function fieldFor(page: Page, label: string | RegExp): Locator {
  return page
    .locator('label', { hasText: label })
    .locator('xpath=following-sibling::input[1]');
}

// Creates a bank account through the /accounts UI and asserts it shows up
// in the list. openingBalance uses the app's French decimal format ("1234,56").
export async function createAccount(
  page: Page,
  name: string,
  openingBalance?: string,
): Promise<void> {
  await page.goto('/accounts');
  await page.getByRole('button', { name: 'Nouveau compte' }).click();
  await fieldFor(page, /^Nom$/).fill(name);
  if (openingBalance !== undefined) {
    await fieldFor(page, /Solde d.ouverture/).fill(openingBalance);
  }
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page.getByText(name)).toBeVisible();
}
