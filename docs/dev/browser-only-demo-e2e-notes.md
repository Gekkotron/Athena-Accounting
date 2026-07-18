# Browser-only demo — E2E follow-up

Unit + component tests for the demo adapter, seed, and banner ship in
`frontend/src/api/demo/__tests__/` (33 tests). What was **not** added
in the same task is Playwright e2e coverage: setting up
`@playwright/test`, browsers, and CI wiring is a fresh infrastructure
step separate from the demo adapter itself.

## What the smoke should exercise

Given a Playwright install and a running `VITE_DEMO=1 npm run preview`
on port 4173, the smoke script should:

1. Land on `/` — expect the demo banner ("Démo — vos actions sont…")
   and the Dashboard to render two accounts with computed balances.
2. Click the Transactions nav item — expect a paginated table with
   at least the seed's ~180 rows and the running-balance column
   populated when an account filter is active.
3. Inline-edit one transaction's category, refresh the page, expect
   the new category to survive (localStorage persistence).
4. Click **Réinitialiser la démo** in the banner — expect the toast
   "Démo réinitialisée." and the edit to be gone.
5. Attempt to open the PDF imports flow — expect the
   `DemoUnavailableModal` (or the French demoStub message) instead of
   a raw stack trace.
6. Load the DevTools Network tab and confirm no request goes to
   `/api/*` beyond static assets.

## Setup outline

```
cd frontend
npm install --save-dev @playwright/test
npx playwright install --with-deps chromium
mkdir -p e2e
# author e2e/demo.spec.ts against the outline above
```

CI: extend `.github/workflows/docs.yml` (or a separate `demo-e2e.yml`)
with a step that runs `npm run preview` in the background, waits for
port 4173, then runs `npx playwright test`.

## Manual verification checklist

- [ ] `VITE_DEMO=1 npm run build:demo && npx serve dist-demo` opens the
      app locally without network calls to `/api/*`.
- [ ] Every top-level nav (Dashboard, Transactions, Budgets, Rules
      children, Comptes children, Données children, Réglages, Profil)
      renders without a raw error.
- [ ] Réinitialiser button flushes local edits.
