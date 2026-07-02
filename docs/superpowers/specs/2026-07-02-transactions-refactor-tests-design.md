# Transactions.tsx refactor + tests — design

**Status:** Draft (awaiting user review)
**Date:** 2026-07-02
**Scope:** Third iteration of the split-code + add-unit-tests interleave initiative. Target: `frontend/src/pages/Transactions.tsx` (746 lines). Reuses the frontend test harness introduced in the Accounts iteration.

## Goal

Split `frontend/src/pages/Transactions.tsx` into small, single-responsibility files under `frontend/src/pages/Transactions/`, guarded by a characterization test suite written first and locked in by unit tests written after. Update `STATUS.md` to mark the Transactions row complete.

## Non-goals

- Backend routes (`backend/src/http/routes/transactions.ts`) untouched.
- E2E tests via Playwright.
- Backend unit tests as opposed to existing integration tests.
- New user-facing features (no changes to filter UI, no bulk-select, no export). Any of those are separate initiatives.
- Fixing already-deferred items from earlier iterations (Node 20 CI bump, `tsconfig.json` test include, `RuleCreateForm.successCount` primitive-equality edge case, extract shared `note` Zod chain, UTC-date default).

## Approach

Approach A from the Accounts and Rules iterations — **Characterize → Split → Unit-test**:

1. Add characterization tests against the **unchanged** `Transactions.tsx`. Suite goes green.
2. Split `Transactions.tsx` into a `pages/Transactions/` directory (pure code motion). Characterization tests remain green after every extraction commit.
3. Add fine-grained unit tests on the extracted subcomponents.

## Characterization test plan

**Location:** `frontend/src/pages/__tests__/Transactions.test.tsx`.

**Common setup:** wrap `<Transactions />` in a fresh `QueryClient` (retries disabled) + `<MemoryRouter>` (needed because the page reads URL search params for account preselection). Mock `../../api/client`'s `api` function with a per-test route map. Reset mock state in `beforeEach`.

**Eight tests, one per user story:**

| # | Test | What it locks in |
|---|---|---|
| 1 | Renders the transaction list + pagination controls | Default query + baseline render |
| 2 | Filter by account (dropdown → refetch → row set changes) | Filter → refetch loop |
| 3 | Search debounce (typing in search input → after debounce interval, refetch with `search=...`) | Debounce split between `searchInput` and `filters.search` |
| 4 | Pagination Next/Prev (offset advances by `PAGE`, request query includes `offset`) | Pagination |
| 5 | Inline category edit (click row category → PUT `{ categoryId }` → row updates) | `updateCategory` mutation shape + refresh |
| 6 | Inline notes edit (click row notes → PUT `{ notes }` → row updates) | `updateNotes` mutation shape + refresh |
| 7 | Delete with confirm (ConfirmDialog → DELETE → row disappears) | Delete flow + confirmation gate |
| 8 | Open TransactionModal (click "add transaction" or equivalent → modal renders) | Modal open path |

**Debounce test technique (Test #3):** use Vitest's fake timers (`vi.useFakeTimers()`, `vi.advanceTimersByTime(300)`) to fast-forward the debounce interval deterministically. This avoids `await waitFor(...)` races that would otherwise couple the test to real-time delays.

**Assertions are user-visible** (text / roles / aria-labels). No `toHaveClass`, no `data-testid`, no state-variable-name assertions. This is the safety-net premise: characterization tests must survive the refactor unchanged.

## Split plan

**New directory:** `frontend/src/pages/Transactions/` with **six files**.

| File (new) | Responsibility | Rough size |
|---|---|---|
| `index.tsx` | Page orchestration: queries (`useQuery` for accounts + categories + transactions), mutations (`updateCategory` / `updateNotes` / `deleteTransaction`), filter state, search-debounce split (raw `searchInput` → debounced `filters.search`), pagination offset, modal open/close, delete confirm state. Renders `<FiltersBar>`, `<TransactionsTable>`, pagination buttons, `<TransactionModal>`, `<ConfirmDialog>`. | ~220 |
| `FiltersBar.tsx` | Filter form: account / category / date-from / date-to / search inputs + the "advanced filters" toggle. Props: `filters`, `searchInput`, `accounts`, `categories`, `onFilterChange(patch)`, `onSearchInputChange(value)`, `showAdvanced`, `onToggleAdvanced`. No debounce inside this component — that stays in the parent. | ~140 |
| `TransactionsTable.tsx` | Table shell with sortable `<Th>` column headers + one `<TransactionRow>` per transaction. Empty-state copy when there are no rows. | ~110 |
| `TransactionRow.tsx` | One row: date / amount / label / category / notes / delete affordance. Owns LOCAL edit state (which cell is currently in inline-edit mode) via `useState`. Props: `tx`, `categories`, `accounts`, `onUpdateCategory`, `onUpdateNotes`, `onDelete`. | ~180 |
| `TransactionModal.tsx` | Create-transaction modal (already an inline component). Owns its own form state; parent renders `<TransactionModal open={...} onClose={...} />`. | ~150 |
| `Th.tsx` | Tiny sortable-header helper. Props: `label`, `field`, `activeField?`, `direction?`, `onSort(field)`. Leaf. | ~30 |

**Import graph (tree rooted at `index.tsx`):**
- `index.tsx` → `FiltersBar`, `TransactionsTable`, `TransactionModal`.
- `TransactionsTable` → `Th`, `TransactionRow`.
- Leaves (`Th`, `TransactionRow`, `FiltersBar`) do not import each other.

**Refactor guarantees:**
- Pure code motion. No new API calls, no changed cache invalidations, no new state fields.
- Cache keys unchanged: `['transactions']`, `['accounts']`, `['categories']`. Any rename silently breaks dependent pages (Dashboard, Categories, Tri).
- Every characterization test remains green after every extraction commit. If a test fails post-extraction, the split is wrong.
- `Transactions.tsx` is deleted in the relocation commit. `App.tsx`'s route import (`import { Transactions } from './pages/Transactions'`) resolves to `./pages/Transactions/index.tsx` via directory-index resolution and does not change.

**Behavior-preservation guardrails (from Accounts + Rules iterations):**
- Search-debounce logic (currently `useEffect` in the main component watching `searchInput` and updating `filters.search` after ~300ms) stays in `index.tsx`. Characterization Test #3 is the safety net for that logic.
- If any subcomponent needs to signal a "clear form" on parent-mutation success (analog to `RuleCreateForm.successCount`), use a **monotonic counter signal** bumped in the parent's `onSuccess`, not the returned `data`. Avoids the primitive-equality edge case flagged as a Rules-iteration deferral.
- Inline-edit "which cell is editing" state stays LOCAL to `TransactionRow` — no need to lift to the parent.
- Any callback that reads state from closure at submit-time passes the draft explicitly (`callback(id, draft)`), with an inline comment explaining why the parameter isn't redundant.

## Unit test plan (post-split)

**Location:** each test file co-located under `frontend/src/pages/Transactions/__tests__/`.

**Files + assertions (target: ~18 assertions across 5 files):**

| Test file | Component | Assertions |
|---|---|---|
| `Th.test.tsx` | `Th` | (a) renders label text; (b) `onSort(field)` fires on click; (c) renders sort indicator when the header is the active sort field. |
| `TransactionRow.test.tsx` | `TransactionRow` | (a) renders row data (date / amount / label / category / notes); (b) inline-edit category → `onUpdateCategory(id, { categoryId })` fires; (c) inline-edit notes → `onUpdateNotes(id, { notes })` fires; (d) ✕ fires `onDelete(tx)`. |
| `TransactionsTable.test.tsx` | `TransactionsTable` | (a) renders one row per transaction; (b) sortable header click bubbles to parent's `onSort`; (c) empty transactions shows empty-state copy. |
| `FiltersBar.test.tsx` | `FiltersBar` | (a) account / category dropdowns populated from props; (b) changing account fires `onFilterChange({ accountId })`; (c) search input fires `onSearchInputChange` synchronously (raw, no debounce here). |
| `TransactionModal.test.tsx` | `TransactionModal` | (a) fields render + submit fires with the shaped body; (b) native-required guard prevents empty submit (or whatever the actual submit gate is); (c) close button fires `onClose`. |

**Coverage:** aspirational ~80% on `frontend/src/pages/Transactions/**`, verified via the Codecov delta.

**Deliberately not tested this iteration:**
- Debounce timing internals — covered by characterization Test #3 via fake timers.
- Optimistic-update rollbacks.
- URL-param → filter preselection edge cases (multiple params, invalid values). If the page reads URL search params, one characterization test can cover the happy path; adversarial cases are separate.

## `STATUS.md` update

At the end of the iteration:
- Mark the `Transactions.tsx` row as ✅ / ✅ / ✅ in the refactor table.
- Add one "Recently landed" line: `2026-07-02 — Transactions.tsx split into pages/Transactions/ (6 focused files) with characterization + unit tests. Third interleave iteration.`
- Bump the `_Last updated:_` date.

## CI

Unchanged. Both `backend-tests` and `frontend-tests` jobs already run every push; new tests fold into `frontend-tests` automatically. Codecov's frontend flag picks up the new coverage.

## Rollout

Ten tasks across three logical PR-scopes, direct commits to `main` (no PR creation, per project convention):

1. **Task 1** — characterization tests.
2. **Tasks 2–7** — split (relocation, then leaf-first extractions).
3. **Tasks 8–10** — unit tests + STATUS.md refresh + push.

## Testing (of this initiative itself)

- After each task: local `npm run test:coverage` in the frontend workspace + `tsc --noEmit`. Then CI must be green before advancing.
- After the final task: manual smoke of the Transactions page in a browser (when Docker is up) to confirm no user-visible regression.

## Open questions

None at time of writing.
