# Accounts.tsx refactor + frontend test harness — design

**Status:** Draft (awaiting user review)
**Date:** 2026-07-01
**Scope:** v1 — first iteration of the "split-code + add-unit-tests" interleave initiative. Target: `frontend/src/pages/Accounts.tsx` (771 lines). Also introduces the frontend test harness (used by this and every future iteration) and a top-level `STATUS.md`.

## Goal

Split `frontend/src/pages/Accounts.tsx` into small, single-responsibility files inside `frontend/src/pages/Accounts/`, guarded by a characterization test suite that captures today's behavior *before* the refactor and by unit tests that lock in the new subcomponents' contracts *after* the refactor. Along the way, stand up the frontend test harness (Vitest + Testing Library + jsdom) that all future iterations will reuse, and add a top-level `STATUS.md` that tracks project state, refactor progress, and known deferrals.

## Non-goals (v1)

- Splitting Rules.tsx, Transactions.tsx, Imports.tsx, or any backend file. Each of those gets its own iteration, tracked in `STATUS.md`.
- Frontend E2E tests (Playwright / Cypress). Component-level tests only.
- Storybook / visual regression.
- Backend unit tests as opposed to the existing integration tests. Reasonable next initiative but a separate ask.
- MSW-style network mocking. We use `vi.mock('../api/client')` because the API surface is thin.
- Optimistic-update rollback coverage or drag-reorder coverage — see "What we deliberately do NOT test" below.

## Approach

Approach A from the brainstorm — **Characterize → Split → Unit-test**:

1. Add the frontend test harness and write characterization tests against **today's unchanged** `Accounts.tsx`. Suite goes green.
2. Split `Accounts.tsx` into a `pages/Accounts/` directory (pure code motion). Characterization tests must still pass, unchanged.
3. Add fine-grained unit tests on the extracted subcomponents.

This is the standard "characterization test before refactor" pattern from *Working Effectively with Legacy Code*: the tests capture behavior, then the refactor is safe because the behavior is guarded.

## Frontend test harness

**Stack:**
- `vitest` (same runner as backend).
- `jsdom` — DOM environment. Chose over happy-dom for fidelity; performance is a non-concern at this scale.
- `@testing-library/react` — component-level, user-behavior-focused tests.
- `@testing-library/jest-dom` — richer matchers.
- `@testing-library/user-event` — realistic user interactions.
- `@vitest/coverage-v8` (already present in backend, add to frontend).

**New files under `frontend/`:**
- `vitest.config.ts` — `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, `globals: true`, coverage settings (v8, `lcov` + `text` reporters).
- `src/test/setup.ts` — imports `@testing-library/jest-dom` and registers `afterEach(cleanup)`.

**Modifications to `frontend/`:**
- `package.json` — add `test: "vitest"` and `test:coverage: "vitest run --coverage"` scripts; add dev-deps `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `@vitest/coverage-v8`.
- `tsconfig.json` — add `"vitest/globals"` (and `"@testing-library/jest-dom"`) to `compilerOptions.types` so `expect`, `describe`, `it` type-check inside tests.

**Network mocking pattern:** `vi.mock('../../api/client', () => ({ api: vi.fn(), ApiError: <re-exported real class> }))`. Each test seeds the mock with the responses its flow needs and asserts the calls it received. `beforeEach` clears history via `vi.clearAllMocks()`.

## Characterization test plan

**Location:** `frontend/src/pages/__tests__/Accounts.test.tsx`.

**Common setup:** every test wraps the page in `<QueryClientProvider>` (fresh `QueryClient` with `retry: false`) and `<MemoryRouter>` (needed for the `<Link to="/transactions?…">` in the transaction counter).

**Six tests, one per user story:**

1. **Renders account list.** Mock `/api/accounts` → two accounts + `/api/account-filename-patterns` → one pattern. Assert both account names visible, patterns section shows one row.
2. **Creates an account.** Fill the create form, click **Créer**. Assert the mock received a POST with body `{ name, type, currency, openingBalance, openingDate }`; assert the accounts query is invalidated; assert the new card renders after the refetch resolves.
3. **Inline-edits an account.** Click **modifier**, change the name, save. Assert the PUT body contains only `{ name }` (only the changed field); assert the card renders with the new name.
4. **Confirms + deletes an account.** Click the delete icon → `ConfirmDialog` renders → confirm → assert DELETE was called; card disappears.
5. **Expands the checkpoint drawer, adds one, hits 409 on duplicate date.** Expand the drawer, add a valid checkpoint (mock → 201, row appears). Repeat with the same date (mock → `ApiError(status: 409, error: 'checkpoint_exists')`). Assert the inline error text `"Un point de contrôle existe déjà à cette date."` renders.
6. **Adds and deletes a filename pattern** via `PatternsSection`. Assert POST + DELETE payloads and the table row appearing / disappearing.

**These six tests are the safety net.** They must all be green **before** any refactor happens, and remain green after the split with **no test-code changes**.

## Split plan

**New directory:** `frontend/src/pages/Accounts/`. Each file has one clear responsibility.

| File (new)                        | Responsibility                                                                                                                                                                                                                                                                                          | Rough size |
|-----------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------|
| `index.tsx`                       | Page-level orchestration: `useQuery` hooks, create/reorder/delete mutations, renders the create form, the account grid, `PatternsSection`, and the `ConfirmDialog`. Owns the drag-reorder state.                                                                                                          | ~200       |
| `AccountCard.tsx`                 | One card in the grid: display mode + inline-edit mode toggle. Renders the transaction counter, opening date, delta, **modifier / supprimer** buttons, and the **▸ Points de contrôle** toggle. Props: `account`, `onEdit`, `onDelete`, `onExpand(id)`, `expanded`.                                        | ~180       |
| `AccountForm.tsx`                 | The "create an account" form at the top, reused for the inline edit mode inside a card — controlled by a `mode: 'create' \| 'edit'` prop. The owning mutation stays in `index.tsx`; this component renders inputs and calls back with the form values.                                                    | ~120       |
| `BalanceCheckpointsDrawer.tsx`    | Expandable drawer. Owns its own `useQuery` for the checkpoint list + the three mutations (create / update / delete) + `mutationError` state. Props: `accountId`, `currency`.                                                                                                                             | ~150       |
| `CheckpointRow.tsx`               | One row in the drawer's table with inline edit-on-click for amount and note. Props: `cp`, `currency`, `onSave`, `onDelete`, `saving`, `deleting`.                                                                                                                                                          | ~85        |
| `PatternsSection.tsx`             | The filename → account patterns CRUD block at the bottom of the page. Moves out of Accounts entirely; behavior unchanged.                                                                                                                                                                                | ~100       |

**Import boundaries:**
- `index.tsx` imports all sibling files. Sibling files do not import each other. Each leaf knows only its props and the API wrappers it needs.
- The old `frontend/src/pages/Accounts.tsx` is deleted in the split commit. `App.tsx`'s route import (`import { Accounts } from './pages/Accounts'`) resolves to `./pages/Accounts/index.tsx` via directory-index resolution — the route line stays identical.

**Refactor guarantees:**
- No behavior change. Every characterization test from the section above must still pass, unchanged, after the split.
- No new API calls, no new types, no new state fields. Pure code motion + prop threading.
- Each subcomponent extraction goes in its own commit inside PR 2 so review sees the deltas cleanly.

## Unit test plan (post-split)

**Location:** each test file co-located with its component under `frontend/src/pages/Accounts/__tests__/`.

**Style:** small, prop-driven, no `<QueryClientProvider>` unless the component actually reads from cache (drawer + row do, so they get one; card, form, patterns don't).

**Files + assertions (target: ~20 assertions across 5 files):**

| Test file                             | Component                    | Assertions                                                                                                                                                                                                                                                                    |
|---------------------------------------|------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `AccountCard.test.tsx`                | `AccountCard`                | (a) display mode renders name / type / currency / balance / opening date. (b) **modifier** click fires `onEdit(id)`. (c) **supprimer** click fires `onDelete(account)`. (d) toggle click fires `onExpand(id)`; chevron rotates. (e) drawer child renders only when `expanded`. |
| `AccountForm.test.tsx`                | `AccountForm`                | (a) create mode: empty defaults + typing + submit fires `onSubmit({name, type, currency, openingBalance, openingDate})`. (b) edit mode: pre-fills from `initial` prop. (c) submit disabled when required fields empty.                                                          |
| `BalanceCheckpointsDrawer.test.tsx`   | `BalanceCheckpointsDrawer`   | (a) empty state text renders when there are no checkpoints. (b) add-row submits `{checkpointDate, expectedAmount, note}` → row appears. (c) 409 → inline error text. (d) `mutationError` clears after a subsequent successful mutation.                                         |
| `CheckpointRow.test.tsx`              | `CheckpointRow`              | (a) click amount → editable input → Enter commits with new `expectedAmount`. (b) blur unchanged reverts, no `onSave` fired (no-op network avoided). (c) click note → edit → Enter commits `note: null` when trimmed to empty. (d) ✕ click fires `onDelete`.                     |
| `PatternsSection.test.tsx`            | `PatternsSection`            | (a) empty state renders. (b) add row fires POST with the correct payload. (c) delete row fires DELETE. (d) account-name lookup renders correctly from the accounts prop.                                                                                                        |

**Coverage:** the aspirational goal is ~80% line coverage on the new `frontend/src/pages/Accounts/` directory, verified via the Codecov delta on PR 3. This is a target, not an enforced gate — CI does NOT fail on missed coverage. Old `Accounts.tsx` reads 0% today; anything above that is a real win, and the drag-reorder / optimistic-update exclusions below explain why 100% is neither feasible nor useful.

**What we deliberately do NOT test in this iteration:**
- **Drag-reorder handlers.** Flaky under jsdom (native drag events aren't fully implemented). If we ever want this covered, it goes into a Playwright E2E — separate initiative.
- **Optimistic-update rollbacks.** Edge case, not user-visible under happy path. Would double the test count for marginal value.
- **TanStack Query cache invalidation ordering.** That's the library's responsibility, not ours.

## `STATUS.md` (project-level status file)

**Location:** repo root — `STATUS.md`.

**Purpose:** a single, human-readable snapshot of *where the project is right now*, updated as work lands. Distinct from:
- `.superpowers/sdd/progress.md` — transient, per-session SDD ledger.
- `TODO.md` — brainstorming and ideas.

**Skeleton:**

```markdown
# Status — Athena Accounting

_Last updated: YYYY-MM-DD_

## Live

Short paragraph: what's currently deployed / usable end-to-end.
CI status: link to GitHub Actions. Coverage: link to Codecov.

## Recently landed

Bullet list of the last ~10 merged changes (most recent first), one line each.

## In flight

What's currently being worked on. Empty most of the time.

## Refactor + tests progress

| File               | Chars. tests | Split | Unit tests |
|--------------------|:------------:|:-----:|:----------:|
| Accounts.tsx       | ⬜           | ⬜    | ⬜         |
| Rules.tsx          | ⬜           | ⬜    | ⬜         |
| Transactions.tsx   | ⬜           | ⬜    | ⬜         |
| Imports.tsx        | ⬜           | ⬜    | ⬜         |
| backup.ts          | ⬜           | ⬜    | ⬜         |

## Known deferrals

Bullet list of accepted-but-deferred issues (from code reviews).

## Environment

One or two lines each: how it runs, target machine. Reference README.md for setup.
```

**Update discipline:** every PR touching the app closes its diff with a `STATUS.md` update — a bullet under **Recently landed**, an updated cell in the refactor table if applicable, and an entry in **Known deferrals** if a Minor review finding was deferred. Zero cost per PR, big value to future readers.

**Seeded initial content (PR 3 creates this file):**
- "Recently landed" starts with the balance-checkpoints feature, the CI + Codecov wiring, and the Accounts refactor+tests.
- "Known deferrals" seeded with the two items from the balance-checkpoints final review (duplicate `note` Zod chain; UTC-date default in the drawer), the Node 20 deprecation in CI, and the `tsconfig.json` gap (does not include `tests/**`).
- Refactor table: `Accounts.tsx` row fully checked; other rows unchecked.

## CI integration

`.github/workflows/ci.yml` gains a second job `frontend-tests`, parallel to `backend-tests`:

```yaml
frontend-tests:
  name: Frontend tests + coverage
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: npm
        cache-dependency-path: frontend/package-lock.json
    - name: Install
      working-directory: frontend
      run: npm ci
    - name: Type-check
      working-directory: frontend
      run: npx tsc -p tsconfig.json --noEmit
    - name: Test + coverage
      working-directory: frontend
      run: npm run test:coverage
    - name: Upload coverage to Codecov
      uses: codecov/codecov-action@v4
      with:
        files: frontend/coverage/lcov.info
        flags: frontend
        fail_ci_if_error: false
        token: ${{ secrets.CODECOV_TOKEN }}
```

- No Postgres service — pure jsdom.
- `flags: frontend` vs. `flags: backend` on the two Codecov uploads → per-flag coverage in the dashboard.
- Both jobs run in parallel (no `needs:` between them), so wall-clock stays close to today's.

## Rollout

One iteration is delivered as **three PRs**, each independently reviewable:

1. **PR 1 — Harness + characterization + CI wiring.** Vitest + Testing Library + jsdom added to the frontend workspace, six characterization tests against **the current unchanged** `Accounts.tsx`, second CI job added. All tests green against today's code.
2. **PR 2 — Split.** Mechanical move: `Accounts.tsx` → `Accounts/` directory with six files. Pure code motion. The six characterization tests still pass, unchanged.
3. **PR 3 — Unit tests + `STATUS.md`.** ~20 unit assertions across five files under `Accounts/__tests__/`. `STATUS.md` created at the repo root with the Accounts row marked complete and known deferrals seeded.

If you'd rather ship it as one PR, we consolidate — but three preserves the discipline of "one gate per review" and keeps each diff small enough to read quickly.

## Testing (of this initiative itself)

- After each PR: local `npm run test:coverage` in the frontend workspace + `tsc --noEmit`. Then CI must be green before merge.
- After PR 3: manual smoke of the Accounts page in a browser (when the user brings up Docker) to confirm no user-visible regression. This is the same manual-verify discipline we used for the balance-checkpoints feature.

## Open questions

None at time of writing. Any that surface during implementation get logged here before code changes.
