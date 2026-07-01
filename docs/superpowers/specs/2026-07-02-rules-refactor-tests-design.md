# Rules.tsx refactor + tests — design

**Status:** Draft (awaiting user review)
**Date:** 2026-07-02
**Scope:** Second iteration of the "split-code + add-unit-tests" interleave initiative. Target: `frontend/src/pages/Rules.tsx` (966 lines). Reuses the frontend test harness already stood up in the Accounts iteration; no new tooling.

## Goal

Split `frontend/src/pages/Rules.tsx` into small, single-responsibility files under `frontend/src/pages/Rules/`, guarded by a characterization test suite that captures today's behavior *before* the refactor and by unit tests that lock in the new subcomponents' contracts *after* the refactor. Update `STATUS.md` to mark the Rules row complete.

## Non-goals

- Backend rule-engine changes (business logic in `backend/src/domain/rules/` untouched).
- E2E tests via Playwright.
- Backend unit tests as opposed to existing integration tests.
- Fixing the deferred items from the previous iteration's STATUS.md (Node 20 bump, tsconfig test-include, extract shared `note` Zod chain, UTC-date default in the checkpoint drawer, etc.). Separate follow-ups.
- Adding drag-reorder / bulk-select or any new user-facing feature.

## Approach

Approach A from the Accounts iteration — **Characterize → Split → Unit-test**:

1. Add characterization tests against the **unchanged** `Rules.tsx`. Suite goes green.
2. Split `Rules.tsx` into a `pages/Rules/` directory (pure code motion). Characterization tests remain green after every extraction commit.
3. Add fine-grained unit tests on the extracted subcomponents.

This is the "characterization test before refactor" pattern from *Working Effectively with Legacy Code*. The tests capture behavior; the refactor becomes safe.

## Characterization test plan

**Location:** `frontend/src/pages/__tests__/Rules.test.tsx`.

**Common setup:** wrap `<Rules />` in a fresh `QueryClient` (retries disabled) and `<MemoryRouter>`. Mock `../../api/client`'s `api` function with a per-test route map. Reset mock state in `beforeEach`.

**Seven tests, one per user story:**

| # | Test | What it locks in |
|---|---|---|
| 1 | Renders the grouped view with rules grouped by category | Default view, category grouping, rule-chip rendering |
| 2 | Toggles from grouped to flat and back | `view` state driving which subcomponent renders |
| 3 | Creates a rule (POST → refresh → rule appears in the list) | Create form → API contract → cache invalidation |
| 4 | Edits a rule via `AdvancedEditor` (PUT body contains only changed fields) | Inline edit → PUT body → refresh |
| 5 | Deletes a rule (ConfirmDialog → DELETE → row disappears) | Delete flow + confirmation gate |
| 6 | Bulk-recategorize (button → confirm → POST `/api/recategorize`) | Recategorize side effect |
| 7 | Empty state — no rules → no crash, appropriate copy renders | Guards the empty-database bootstrap path |

**Assertions are user-visible** (text, roles, aria-labels). No implementation details (`toHaveClass`, `data-testid`, state-variable names). This is the "safety net" premise: characterization tests must survive the refactor unchanged.

## Split plan

**New directory:** `frontend/src/pages/Rules/` with **eight files**.

| File (new) | Responsibility | Rough size |
|---|---|---|
| `index.tsx` | Page orchestration: queries (`useQuery` for rules + categories), mutations (`create` / `update` / `delete` / `recategorize`), view-mode state (`grouped` \| `flat`), owns `editing` + `confirmDeleteRule` + `confirmRecat` + `deleteError`. Renders the create form, view toggle, and delegates to `GroupedView` / `FlatTable` + the confirm dialogs. | ~220 |
| `RuleCreateForm.tsx` | Top-of-page create form: keyword input (with suggestion chip), category select, sign constraint, match mode, priority. `onSubmit(body)` calls back with the create payload. | ~120 |
| `GroupedView.tsx` | Renders rules grouped by category. Maps to `<CategoryRow>` per group. | ~50 |
| `CategoryRow.tsx` | One group in the grouped view: category header + chips of rules. Chips trigger `onEdit(rule)` / `onDelete(rule)` callbacks. | ~110 |
| `FlatTable.tsx` | Alternative flat list of rules with per-row edit/delete affordances. | ~140 |
| `AdvancedEditor.tsx` | Inline advanced editor rendered when `editing !== null`. Owns its own draft state (seeded from `rule` prop), calls back `onSubmit(patch)` with only-changed fields, `onCancel` on cancel. | ~150 |
| `NormalizationHint.tsx` | Label-normalization hint block. Leaf UI, local `open` toggle. | ~50 |
| `Chip.tsx` | Small reusable tag component (label + optional `onClick`). Leaf. | ~50 |

**Import graph (tree rooted at `index.tsx`):**
- `index.tsx` imports all seven siblings.
- `GroupedView` → `CategoryRow`, `Chip`, `AdvancedEditor`.
- `CategoryRow` → `Chip`, `AdvancedEditor`.
- `FlatTable` → `Chip`, `AdvancedEditor`.
- `RuleCreateForm` → `Chip` (for keyword suggestions), `NormalizationHint`.

**Refactor guarantees:**
- Pure code motion. No new API calls, no changed cache invalidations, no new state fields.
- Cache keys unchanged: `['rules']`, `['categories']`. Any rename silently staleifies dependent pages.
- Every characterization test remains green after every extraction commit. If any test fails post-extraction, the split is wrong.
- Rules.tsx is deleted in the initial relocation commit. `App.tsx`'s route import (`import { Rules } from './pages/Rules'`) resolves to `./pages/Rules/index.tsx` via directory-index resolution and does not change.

**Behavior-preservation guardrails (lessons from the Accounts iteration):**
- `AdvancedEditor` follows the same discipline as `AccountForm`: extracts a self-contained form, receives `initial: Rule` prop, calls back with `onSubmit(values)`. The parent diffs `values` against the original rule to build the PUT patch — guarded by characterization Test #4.
- Any React callback that reads state from closure — e.g. `saveEdit(rule)` — passes the draft explicitly (`saveEdit(rule, draft)`) with an inline comment explaining why the parameter isn't redundant. Same pattern used for `saveEdit(a, draft)` in Accounts's `index.tsx`.

## Unit test plan (post-split)

**Location:** each test file co-located with its component under `frontend/src/pages/Rules/__tests__/`.

**Files + assertions (target: ~20 assertions across 7 files):**

| Test file | Component | Assertions |
|---|---|---|
| `RuleCreateForm.test.tsx` | `RuleCreateForm` | (a) fields render + submit fires with correct body; (b) keyword-suggestion chip click adds a keyword to the input; (c) submit disabled when required fields are empty. |
| `GroupedView.test.tsx` | `GroupedView` | (a) renders one `CategoryRow` per category; (b) rule count per row matches input data; (c) empty grouped list renders nothing (no crash). |
| `CategoryRow.test.tsx` | `CategoryRow` | (a) header renders category name; (b) each rule chip is visible; (c) chip click fires `onEdit(rule)`; (d) delete affordance fires `onDelete(rule)`. |
| `FlatTable.test.tsx` | `FlatTable` | (a) all rules render as rows; (b) edit button fires `onEdit(rule)`; (c) delete button fires `onDelete(rule)`; (d) empty table shows empty-state copy. |
| `AdvancedEditor.test.tsx` | `AdvancedEditor` | (a) pre-fills from `rule` prop; (b) `onSubmit(patch)` receives only-changed fields; (c) `onCancel` fires. |
| `NormalizationHint.test.tsx` | `NormalizationHint` | (a) collapsed by default; (b) expand toggle reveals the hint copy. |
| `Chip.test.tsx` | `Chip` | (a) renders the label; (b) click fires `onClick` (when provided). |

**Coverage:** aspirational ~80% on `frontend/src/pages/Rules/**`, verified via Codecov delta on PR 3. Not enforced by CI.

**Deliberately not tested this iteration:**
- Rule priority reordering (if it exists — check on implementation; drag-based reorder is out of scope for jsdom).
- Bulk selection / bulk delete (not in today's UI; if it appears later, own initiative).
- TanStack Query cache invalidation ordering (library concern).

## `STATUS.md` update

At the end of PR 3:
- Mark the `Rules.tsx` row in the refactor progress table as ✅.
- Add one line under "Recently landed": `2026-07-02 — Rules.tsx split into pages/Rules/ (8 focused files) with characterization + unit tests. Second interleave iteration; harness unchanged.`

No new "Known deferrals" expected from this iteration unless review turns some up.

## CI

Unchanged. Both `backend-tests` and `frontend-tests` jobs already run every push; the new tests fold into `frontend-tests` automatically. Codecov's frontend flag will pick up the new coverage.

## Rollout

Three PRs, same discipline as the Accounts iteration:

1. **PR 1 — Characterization tests.** Seven tests against the unchanged `Rules.tsx`. All green.
2. **PR 2 — Split.** Mechanical extraction into `pages/Rules/` — one component per commit. Characterization suite stays green throughout.
3. **PR 3 — Unit tests + STATUS.md refresh.** ~20 unit assertions across 7 files, Rules row marked complete.

If preference shifts to a single-PR delivery, we consolidate — but three PRs preserve the discipline of "one gate per review."

## Testing (of this initiative itself)

- After each PR: local `npm run test:coverage` in the frontend workspace + `tsc --noEmit`. Then CI must be green before merge.
- After PR 3: manual smoke of the Règles page in a browser (when Docker is up) to confirm no user-visible regression. Same manual-verify discipline used for balance checkpoints and the Accounts iteration.

## Open questions

None at time of writing. Any that surface during implementation get logged here before code changes.
