# Browser-Only Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fully interactive, browser-only demo of Athena at `/demo/` on the public docs site — no backend, no cloud, no signup. All state lives in `localStorage`; a "Reset demo" button restores the seed data. Aimed at first-touch conversion: a visitor lands from the README, clicks *Try the demo*, sees the dashboard populated with realistic French bank data, and can categorise, budget, and browse without installing anything.

**Architecture:** Single Vite build gated by `VITE_DEMO=1`. When the flag is on:
- `frontend/src/api/client.ts` `api()` and `apiUpload()` are replaced (compile-time) by a localStorage-backed adapter in `frontend/src/api/demo/`.
- Auth is short-circuited (`/api/auth/me` returns a hard-coded demo user; login page is unreachable).
- All mutating endpoints write through the adapter; reads hydrate from `localStorage.athena_demo_state` (JSON blob) on first render.
- A persistent `DemoBanner` component sits at the top of `Layout.tsx` explaining "This is a demo. Data is stored in your browser only. [Reset]".
- File-based imports (PDF/CSV/OFX) are stubbed with a friendly modal ("Not available in the demo — install Athena to use this").
- MCP token endpoints are stubbed similarly.

The demo build outputs to `frontend/dist-demo/`. A new GH Actions job publishes it to the Docusaurus `gh-pages` branch under `/demo/`, alongside the docs.

**Tech Stack:** React 18 + Vite + TanStack Query + Tailwind 3 + Docusaurus (existing). No new runtime deps.

## Global Constraints

- **No backend changes.** This is a frontend-only effort.
- **No new UI patterns.** Reuse existing `ink-*`, `sage-*`, `clay-*`, layout components. The demo banner is a single-row strip using existing colours.
- **Seed data is public-safe.** No real names, no real IBANs, no realistic email addresses. Vendor labels use plausible-but-fake French chains ("Café du Coin", "Boulangerie Martin"). Amounts are round-ish and non-suspicious.
- **`localStorage` schema is versioned.** `athena_demo_state.v` = 1. On version mismatch, wipe and reseed silently.
- **Same components, no forks.** If a page can't work in demo mode (e.g. imports), it renders normally but calls into a stub that shows the "not available" modal — do NOT fork the page components.
- **`VITE_DEMO` is compile-time only.** Runtime checks are OK but the fallback adapter must tree-shake out of the production build.
- **Attribution.** Every commit uses `-c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com`. No `Co-Authored-By` trailer.
- **Direct commits on `main`.** No branches. Push only when the plan is done.
- **French UI stays the primary language** (the app is French-first; the demo banner uses French copy).

---

## Task 1: Adapter scaffolding + `VITE_DEMO` flag

**Files:**
- Modify: `frontend/vite.config.ts` (expose `VITE_DEMO` to `import.meta.env`, output to `dist-demo/` when set)
- Modify: `frontend/package.json` (add `build:demo` script)
- Create: `frontend/src/api/demo/index.ts` (adapter entry — same signature as `client.ts`'s `api()` / `apiUpload()`)
- Create: `frontend/src/api/demo/store.ts` (localStorage read/write + versioned schema + seed loader)
- Modify: `frontend/src/api/client.ts` (route through demo adapter when `import.meta.env.VITE_DEMO === '1'`)

**Interfaces:**
- Adapter exports `api<T>(path, init?)` and `apiUpload<T>(path, file, opts?)` matching `client.ts` shapes.
- Store exposes `getState()`, `setState(mutator)`, `reset()`, `subscribe(fn)` (last is for the banner "reset" button to trigger a re-render).

- [ ] **Step 1: Vite + package scripts**
- [ ] **Step 2: Adapter entry with `path → handler` map (empty handlers OK)**
- [ ] **Step 3: Store with versioned schema, seed hook, subscribe**
- [ ] **Step 4: Wire the compile-time switch inside `client.ts`**
- [ ] **Step 5: Smoke — `VITE_DEMO=1 npm run dev` boots without runtime errors, network tab is empty**

## Task 2: Seed data

**Files:**
- Create: `frontend/src/api/demo/seed.ts` (in-memory seed matching the app's TS types from `frontend/src/api/types.ts`)

**Contents:**
- 2 accounts: "Compte courant" (EUR, opening 2500 €), "Livret A" (EUR, opening 8000 €).
- ~180 transactions over the last 6 months, weighted realistic (recurring: rent, salaire, EDF, internet, phone; discretionary: grocery, restaurants, transports; one large blip: "Vacances août 2026 —2 800 €").
- 8 categories (dépenses: Courses, Restaurant, Transport, Logement, Énergie, Loisirs, Santé; revenus: Salaire).
- 5 rules pre-configured (e.g. "sncf" → Transport, "carrefour" → Courses).
- 3 budgets: Courses (400 €), Restaurant (150 €), Loisirs (100 €).
- 1 balance checkpoint on Compte courant 3 months ago (matches computed value, so it's a green diamond, not amber).
- No PDF templates, no imports history, no transfer-rules.

- [ ] **Step 1: Define seed constants**
- [ ] **Step 2: Verify types compile against `frontend/src/api/types.ts`**
- [ ] **Step 3: Store hook loads seed on first mount / after reset**

## Task 3: Read-side handlers

Wire each `GET` endpoint the frontend calls, in this order (highest visibility first):

- [ ] `/api/auth/me` — returns `{ userId: 'demo', username: 'Démo' }`, never 401.
- [ ] `/api/onboarding/status` — `{ onboarded: true }`.
- [ ] `/api/accounts` — list from store.
- [ ] `/api/categories` — list from store.
- [ ] `/api/rules`, `/api/transfer-rules`, `/api/budgets`, `/api/settings`.
- [ ] `/api/transactions` — paginated + filterable; implement the same query params (`account`, `from`, `to`, `q`, `page`, `limit`, `category`).
- [ ] `/api/reports/balance`, `/timeseries`, `/categories`, `/budget` — compute on the fly from the transactions array; no caching.
- [ ] `/api/tri/groups` — group uncategorised transactions by normalised label.
- [ ] `/health` — `{ok: true, mode: 'demo'}`.

Each handler is a pure function of the current store state — no side effects. Tests: one `describe` block per resource, seeded from a small fixture, asserting the response shape matches what `types.ts` declares.

## Task 4: Write-side handlers

- [ ] `POST/PUT/DELETE /api/accounts[/…]` — mutate store, re-broadcast.
- [ ] `PATCH /api/transactions/:id` (inline category edit) — mark `is_manual = true`, persist.
- [ ] `POST/PUT/DELETE /api/categories[/…]`, `/api/rules[/…]`, `/api/budgets[/…]`, `/api/transfer-rules[/…]`.
- [ ] `POST /api/tri/assign` — bulk assign + optional rule creation.
- [ ] `POST /api/recategorize` — walk transactions, re-apply rules where `is_manual=false`.
- [ ] `PATCH /api/settings` — merge into JSONB blob.
- [ ] `GET /api/backup/export` — synthesises the JSON envelope; browser downloads via `Blob`.

Every write goes through `store.setState(mutator)` which persists to `localStorage` in the same tick and notifies subscribers. Debounce persistence at 250 ms to avoid write storms during bulk ops.

## Task 5: Stubbed endpoints + "not available" modal

- [ ] `POST /api/imports` (all file types) — reject with a typed `ApiError` whose `data.demoStub = true`.
- [ ] `GET/POST /api/pdf-templates[/…]` — same.
- [ ] `POST /api/mcp/tokens[/…]` — same.
- [ ] `errorMessage.ts` learns to detect `demoStub` and returns a fixed French message: *"Cette fonctionnalité n'est pas disponible dans la démo. Installez Athena pour l'utiliser."*
- [ ] A shared `<DemoUnavailableModal>` shown by the affected pages when they catch a `demoStub` error.

## Task 6: Demo banner + reset

- [ ] Create `frontend/src/components/DemoBanner.tsx`:
  - Only renders when `import.meta.env.VITE_DEMO === '1'`.
  - Copy: *"Démo — vos actions sont enregistrées uniquement dans votre navigateur. [Réinitialiser la démo]"*.
  - Reset button: `store.reset()` → toast "Démo réinitialisée." → TanStack Query cache invalidated.
- [ ] Mount inside `Layout.tsx` above the top bar.
- [ ] Layout height adjusts (banner is 32 px; the app's fixed offsets need to account for it).

## Task 7: Docs site integration

- [ ] Add a `/docs/demo` page (Docusaurus) that iframes `/demo/` with a note explaining the sandboxing.
- [ ] README top: add a big "Try the demo" badge just above the install badges, linking to the docs page.
- [ ] `docs/users/getting-started.md`: add a "Try before you install" callout at the top pointing to the demo URL.

## Task 8: CI + deploy

- [ ] New GH Actions workflow step (extend the existing `docs.yml` or add `demo.yml`):
  - Runs on pushes to `main` that touch `frontend/**` or the workflow file.
  - `npm ci` in `frontend/`, `VITE_DEMO=1 npm run build:demo`.
  - Publishes `frontend/dist-demo/` into the `gh-pages` branch at `/demo/`, preserving the Docusaurus content at `/`.
- [ ] Verify the demo URL renders on GH Pages (`https://gekkotron.github.io/Athena-Accounting/demo/`) and localStorage isolation works (opening the docs site and the demo in the same tab don't collide — different origins? Same origin, different path — namespace the localStorage key with `athena_demo_` prefix, which we already do).

## Task 9: Tests + verification

- [ ] Unit tests: per-resource handler suites in `frontend/src/api/demo/__tests__/`.
- [ ] Component test: `DemoBanner` renders only under the flag, reset clears state.
- [ ] Playwright smoke (in `frontend/e2e/demo.spec.ts`): boot `VITE_DEMO=1 npm run preview`, land on `/`, click through Dashboard → Transactions → assign a category → Reset — assert seed comes back.
- [ ] Manual: run `npm run build:demo`, `npx serve dist-demo`, walk every top-level nav item, confirm no network calls in DevTools.

## Task 10: Ship

- [ ] All checkboxes above ticked.
- [ ] `PLAN.md` task moved from `## In progress` to `## Done`.
- [ ] Blog post announcing the demo goes out with the release notes for the next tagged version.

---

## Out of scope

- Multi-user demo state (each visitor's localStorage is their own; no shared demo).
- PDF/CSV/OFX imports — parsing needs Node APIs the browser doesn't provide cheaply. The stub modal is the deliberate answer.
- MCP endpoint — needs a running Node process; will remain "install to use".
- Server-Side Rendering of the demo. Vite SPA is fine; SEO of the demo page itself doesn't matter (the docs page around it does).
- Real accessibility audit — inherit whatever the main app has; do not regress, but don't scope new work here.
