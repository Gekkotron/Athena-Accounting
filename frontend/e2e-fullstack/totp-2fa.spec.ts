import { test, expect, type Page } from '@playwright/test';
import { generateTotpCode } from '../e2e-shared/totp';

// Full TOTP 2FA flow against the real backend. Runs after fullstack.spec.ts
// (files sort alphabetically, fullstack < totp-2fa) so the `e2e-user`
// account is already onboarded — we just log in with its password and
// drive the UI through enrol → logout → TOTP login → recovery-code login
// → disable.
//
// Codes are computed locally from the base32 secret the enrol modal
// reveals. That works because a fresh code lands in the same 30-second
// window the server samples on /confirm and /verify; no clock stubbing
// needed (page.clock.install would only affect the browser, not the
// backend). If a run straddles a 30 s boundary and the code drifts, the
// server's ±1 window slop still accepts it.

const USERNAME = 'e2e-user';
const PASSWORD = 'athena-e2e-password';

test.describe.configure({ mode: 'serial' });

async function loginPasswordStep(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

// Yields a fresh TOTP code that satisfies BOTH:
//   1. server-side replay guard (last_used_counter must strictly
//      advance — see backend/src/http/routes/auth/totp.ts) — so each
//      call must land in a strictly newer 30 s window than the previous
//      one, otherwise the verify endpoint 401s with "Code invalide".
//   2. window-boundary safety — the fill + click + verify round-trip
//      must fit inside the ±1 window slop, so we only hand out a code
//      when we're at least a few seconds inside its window.
let lastUsedCounter = 0;
async function currentTotp(secret: string): Promise<string> {
  const safeCutoff = 25;
  for (;;) {
    const now = Math.floor(Date.now() / 1000);
    const counter = Math.floor(now / 30);
    const posInWindow = now % 30;
    if (counter > lastUsedCounter && posInWindow < safeCutoff) {
      lastUsedCounter = counter;
      return generateTotpCode(secret);
    }
    // Sleep to the top of the next window plus a small buffer.
    const waitMs = (30 - posInWindow + 1) * 1000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

// Cached across the serial suite. Populated during the enrol test; used
// by the login-with-TOTP + disable tests.
let sharedSecret: string | null = null;
let sharedRecoveryCodes: string[] = [];

test('enrol: password → QR + secret → verify code → save recovery codes', async ({ page }) => {
  await loginPasswordStep(page);
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/settings/security');
  await page.getByRole('button', { name: 'Activer' }).click();

  // Step 1 — confirm password.
  await page.getByLabel('Mot de passe actuel').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Step 2 — QR + base32 secret + 6-digit code.
  await expect(page.getByText('Scanner le QR code')).toBeVisible();
  const secretLocator = page.locator('code').filter({ hasText: /^[A-Z2-7]{16,}$/ }).first();
  await expect(secretLocator).toBeVisible();
  const secret = (await secretLocator.textContent())!.trim();
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  sharedSecret = secret;

  await page.getByLabel('Code à 6 chiffres').fill(await currentTotp(secret));
  await page.getByRole('button', { name: 'Vérifier' }).click();

  // Step 3 — recovery codes revealed once.
  await expect(page.getByText('Sauvegarder vos codes')).toBeVisible();
  const codeItems = page.locator('ul >> li').filter({ hasText: /^[a-z0-9-]+$/i });
  await expect(codeItems).toHaveCount(10);
  const codes = await codeItems.allTextContents();
  expect(codes.every((c) => /^\S+$/.test(c))).toBe(true);
  sharedRecoveryCodes = codes.map((c) => c.trim());

  await page.getByRole('checkbox', { name: /sauvegardé/i }).check();
  await page.getByRole('button', { name: 'Terminer' }).click();

  // Card flips to enabled state.
  await expect(page.getByText('Activée')).toBeVisible();
  await expect(page.getByText(/10 codes de récupération restants/)).toBeVisible();
});

test('login with TOTP code after logout', async ({ page }) => {
  // May sleep up to ~30 s waiting for a fresh TOTP window after the
  // enrol step — the server's replay guard rejects a code re-used in
  // the same 30 s counter.
  test.setTimeout(90_000);
  expect(sharedSecret).not.toBeNull();
  // Log out via the profile menu route. /api/auth/logout is unauthenticated
  // and safe to POST directly through the request context.
  await page.request.post('/api/auth/logout');

  await loginPasswordStep(page);
  // Second step now shows up instead of landing on /.
  await expect(page.getByLabel('Code à 6 chiffres')).toBeVisible();
  await page.getByLabel('Code à 6 chiffres').fill(await currentTotp(sharedSecret!));
  await page.getByRole('button', { name: 'Vérifier' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('login with a recovery code, then that code no longer works', async ({ page }) => {
  expect(sharedRecoveryCodes.length).toBe(10);
  await page.request.post('/api/auth/logout');

  await loginPasswordStep(page);
  await expect(page.getByLabel('Code à 6 chiffres')).toBeVisible();
  await page.getByRole('button', { name: /Utiliser un code de récupération/i }).click();

  const recoveryInput = page.getByLabel('Code de récupération');
  await expect(recoveryInput).toBeVisible();
  const usedCode = sharedRecoveryCodes[0]!;
  await recoveryInput.fill(usedCode);
  await page.getByRole('button', { name: 'Vérifier' }).click();
  await expect(page).toHaveURL(/\/$/);

  // Card now shows 9 codes left — the burnt one cannot be replayed.
  await page.goto('/settings/security');
  await expect(page.getByText(/9 codes de récupération restants/)).toBeVisible();

  // Second attempt with the same code must fail — one-shot burn on the
  // backend leaves used_at set, so the verify route rejects it as invalid.
  await page.request.post('/api/auth/logout');
  await loginPasswordStep(page);
  await page.getByRole('button', { name: /Utiliser un code de récupération/i }).click();
  await page.getByLabel('Code de récupération').fill(usedCode);
  await page.getByRole('button', { name: 'Vérifier' }).click();
  await expect(page.getByText(/Code invalide/i)).toBeVisible();
});

test('disable 2FA with password + fresh TOTP code', async ({ page }) => {
  // Two TOTP verifications back-to-back require a fresh window between
  // them (replay guard) — that plus the fresh-page login can easily
  // land in a 90+ s test.
  test.setTimeout(120_000);
  expect(sharedSecret).not.toBeNull();

  // Playwright gives each test a fresh page, so re-do the full login
  // rather than continuing from where the recovery-code test left off.
  await loginPasswordStep(page);
  await expect(page.getByLabel('Code à 6 chiffres')).toBeVisible();
  await page.getByLabel('Code à 6 chiffres').fill(await currentTotp(sharedSecret!));
  await page.getByRole('button', { name: 'Vérifier' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/settings/security');
  await page.getByRole('button', { name: 'Désactiver' }).click();

  // The Désactiver ConfirmDialog has no accessible name — filter on
  // its inner text (Désactiver ... 2FA prompt copy).
  const dialog = page.getByRole('dialog').filter({ hasText: /Désactiver/i });
  await dialog.getByLabel('Mot de passe').fill(PASSWORD);
  await dialog.getByLabel(/Code TOTP/).fill(await currentTotp(sharedSecret!));
  await dialog.getByRole('button', { name: 'Désactiver' }).click();

  // Card flips back to the disabled state, offering "Activer" again.
  await expect(page.getByRole('button', { name: 'Activer' })).toBeVisible();
});
