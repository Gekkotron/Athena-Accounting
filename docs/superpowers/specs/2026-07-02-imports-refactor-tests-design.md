# Imports.tsx refactor + tests — design

**Status:** Draft (awaiting user review)
**Date:** 2026-07-02
**Scope:** Fourth iteration of the split-code + add-unit-tests interleave initiative. Target: `frontend/src/pages/Imports.tsx` (787 lines). Reuses the frontend test harness introduced in the Accounts iteration.

## Goal

Split `frontend/src/pages/Imports.tsx` into small, single-responsibility files under `frontend/src/pages/Imports/`, guarded by a characterization test suite written first and locked in by unit tests written after. Update `STATUS.md` to mark the Imports row complete.

## Non-goals

- Backend routes (`backend/src/http/routes/imports.ts`) untouched.
- E2E tests via Playwright.
- Backend unit tests as opposed to existing integration tests.
- Refactoring the already-modular `components/PdfTemplateBuilder/` — only the *orchestration* wrapper around it moves.
- New user-facing features (no changes to upload UI, no bulk-select on duplicates, no new backup format).
- Fixing already-deferred items from earlier iterations.

## Approach

Approach A from all prior iterations — **Characterize → Split → Unit-test**:

1. Add characterization tests against the **unchanged** `Imports.tsx`. Suite goes green.
2. Split `Imports.tsx` into a `pages/Imports/` directory (pure code motion). Characterization tests remain green after every extraction commit.
3. Add fine-grained unit tests on the extracted subcomponents.

## Characterization test plan

**Location:** `frontend/src/pages/__tests__/Imports.test.tsx`.

**Common setup:** wrap `<Imports />` in a fresh `QueryClient` (retries disabled) + `<MemoryRouter>`. Mock `../../api/client`'s `api` function with a per-test route map. For file uploads, use `apiUpload` — read `frontend/src/api/client.ts` to determine whether it needs a separate mock or is bundled under `api`.

**Seven tests, one per user story:**

| # | Test | What it locks in |
|---|---|---|
| 1 | Renders the upload form + file-imports list | Default page render |
| 2 | Uploads a CSV file (POST `/api/imports` → success banner with inserted count) | Basic upload → invalidate → render |
| 3 | PDF upload → needsTemplate → PdfTemplateBuilder is rendered | PDF wizard trigger path |
| 4 | PDF upload → auto-imported → lastImported success block visible | PDF happy path |
| 5 | Duplicates panel: renders a group, "not a duplicate" button fires PATCH with single-field body | Dup-panel mark-not-duplicate |
| 6 | Delete a past file-import (confirm dialog → DELETE → row disappears) | File-import deletion flow |
| 7 | Backup export button + restore file input (both fire the correct mutation) | Backup/restore |

**Assertions user-visible** (text / roles / aria-labels). No `toHaveClass`, no `data-testid`, no state-variable-name assertions.

## Split plan

**New directory:** `frontend/src/pages/Imports/` with **six files**.

| File (new) | Responsibility | Rough size |
|---|---|---|
| `index.tsx` | Page orchestration: top-level queries (`accountsQ`, `importsQ`, `dupsQ`), pending-import handoff state (`pendingImport`, `needsTpl`, `lastImported`, `pdfPending`), confirm-dialog state (`pendingDeleteImport`), delete-import mutation. Renders `<UploadForm>` + `<PdfTemplateWizard>` + `<DuplicatesPanel>` + `<FileImportsList>` + `<BackupPanel>` + `<ConfirmDialog>`. | ~180 |
| `UploadForm.tsx` | File input + account select + upload button. Owns local `file`/`accountId`/`error`/`lastResult` state. On submit, branches on extension: OFX/CSV → `upload.mutate`; PDF → calls parent's `onPdfDraft`/`onPdfImported` after inspecting the response. | ~180 |
| `PdfTemplateWizard.tsx` | PDF template flow wrapper: renders `<PdfTemplateBuilder>` (from `components/PdfTemplateBuilder/`) when `needsTpl` is set, plus the `lastImported` success banner. Pure prop-driven; owns no state. | ~80 |
| `DuplicatesPanel.tsx` | "Possibles doublons" section: renders grouped duplicate transactions with "not a duplicate" + delete affordances. Owns `confirmDeleteTxId`/`dupDeleteError` state + `markNotDuplicateMut` + `deleteTxMut` mutations. | ~150 |
| `FileImportsList.tsx` | Past file imports table: filename / date / inserted / dedup-skipped / stated-balance-edit / delete button. Owns the stated-balance inline-edit state + the edit mutation. Delete flows to parent via `onRequestDelete(fileImport)`. | ~180 |
| `BackupPanel.tsx` | Export/backup + restore-from-backup section. Owns `backupError`/`backupResult`/`exporting` state + the backup/restore mutations. | ~100 |

**Import graph (tree rooted at `index.tsx`):**
- `index.tsx` imports all five siblings.
- No sibling-to-sibling imports; each subcomponent stays self-contained around its own API surface + the parent's callback props.
- `components/PdfTemplateBuilder/` untouched; `PdfTemplateWizard.tsx` just wraps it.

**Refactor guarantees:**
- Pure code motion. Cache keys unchanged: `['imports']`, `['dups']`, `['accounts']`. Any rename silently breaks dependent pages.
- Every characterization test remains green after every extraction commit.
- `Imports.tsx` deleted in the relocation commit. `App.tsx`'s route import (`import { Imports } from './pages/Imports'`) resolves to `./pages/Imports/index.tsx` via directory-index resolution and does not change.

**Behavior-preservation guardrails (from prior iterations):**
- **Pending-import handoff** between upload and PDF-template wizard involves state crossing subcomponent boundaries (`pendingImport`, `needsTpl`, `lastImported`, `pdfPending`). Keep this state in `index.tsx`; expose setters through props. `UploadForm` sets; `PdfTemplateWizard` consumes. Do NOT try to lift `pendingImport` into the wizard.
- Any callback that reads state from closure at submit-time passes the current value explicitly (`callback(id, draft)`), with an inline comment explaining why the parameter isn't redundant. Same pattern as Rules's `saveEdit(a, draft)`.
- **Single-field PATCH bodies** — the duplicates panel's "not a duplicate" mutation and the file-imports list's inline stated-balance edit both send patches. Preserve single-field-only patch shape; guarded by characterization Tests #5 and (implicitly via list-render assertion) #6.
- **Cache invalidation on upload success** — verify which query keys the current `upload.mutate.onSuccess` invalidates (`['imports']`, `['accounts']`, potentially `['transactions']`, `['reports']`, `['tri-groups']`) and preserve verbatim in the extracted `UploadForm`.

## Unit test plan (post-split)

**Location:** each test file co-located under `frontend/src/pages/Imports/__tests__/`.

**Files + assertions (target: ~20 assertions across 5 files):**

| Test file | Component | Assertions |
|---|---|---|
| `UploadForm.test.tsx` | `UploadForm` | (a) file input + account select render; (b) OFX/CSV submit fires the mocked upload with correct FormData; (c) PDF submit calls `onPdfDraft`/`onPdfImported` (whichever the backend returns); (d) submit disabled when required fields empty. |
| `PdfTemplateWizard.test.tsx` | `PdfTemplateWizard` | (a) renders `<PdfTemplateBuilder>` when `needsTpl` is set; (b) renders the success banner when `lastImported` is set; (c) renders nothing when both are null. |
| `DuplicatesPanel.test.tsx` | `DuplicatesPanel` | (a) empty state (no groups) renders nothing / empty copy; (b) group renders per duplicate cluster; (c) "not a duplicate" button fires PATCH with `Object.keys(patch).toEqual(['notDuplicate'])` single-field body; (d) delete opens confirm + fires DELETE. |
| `FileImportsList.test.tsx` | `FileImportsList` | (a) each import renders with filename / date / counts; (b) inline stated-balance edit fires PATCH with `Object.keys(patch).toEqual([...])` single-field body; (c) delete button fires `onRequestDelete(fileImport)`. |
| `BackupPanel.test.tsx` | `BackupPanel` | (a) export button fires backup mutation; (b) restore file input fires restore mutation with FormData; (c) success/error banners render appropriately. |

**Coverage:** aspirational ~80% on `frontend/src/pages/Imports/**`, verified via Codecov delta.

**Deliberately not tested this iteration:**
- Full PDF-template roundtrip through `PdfTemplateBuilder` — that component has its own tests (or lack thereof); the wizard tests cover the mount boundary only.
- Backup file-format edge cases (malformed uploads, size limits) — separate initiative if needed.
- Concurrent-upload race conditions.

## `STATUS.md` update

At the end of the iteration:
- Mark the `Imports.tsx` row as ✅ / ✅ / ✅ in the refactor table.
- Add one "Recently landed" line: `2026-07-02 — Imports.tsx split into pages/Imports/ (6 focused files) with characterization + unit tests. Fourth interleave iteration.`
- Bump `_Last updated:_`.

## CI

Unchanged. Frontend job picks up the new tests automatically.

## Rollout

Ten tasks across three logical PR-scopes, direct commits to `main`:

1. **Task 1** — 7 characterization tests.
2. **Tasks 2–7** — split: relocate + 5 extractions (`UploadForm`, `PdfTemplateWizard`, `DuplicatesPanel`, `FileImportsList`, `BackupPanel`).
3. **Tasks 8–10** — unit tests (leaves in Task 8, containers/rest in Task 9) + `STATUS.md` refresh + push.

## Testing (of this initiative itself)

- After each task: local `npm run test:coverage` in the frontend workspace + `tsc --noEmit`. Then CI must be green before advancing.
- After the final task: manual smoke of the Imports page in a browser (when Docker is up) to confirm no user-visible regression.

## Open questions

None at time of writing.
