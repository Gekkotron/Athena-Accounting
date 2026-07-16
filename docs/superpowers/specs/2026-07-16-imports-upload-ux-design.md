# Imports upload UX — design

**Date:** 2026-07-16
**Status:** approved, ready for plan
**Scope:** Three additive improvements to the file-upload flow on the
Imports page — a drag-and-drop zone, a preview-before-import step for
OFX/CSV single-file uploads, and per-item retry from the batch summary.
No new file formats, no new sources/connectors — those are separate
sub-projects (see "Deferred" below).

## Problem

The current upload flow in `frontend/src/pages/Imports/UploadForm.tsx`
works but has three visible friction points:

1. **No drag-and-drop.** The only way to select files is the native file
   dialog or the "ou choisir un dossier" folder picker. Users dragging
   from Finder/Explorer have nowhere to drop.
2. **No preview before commit.** For OFX/CSV, the file is parsed and
   inserted in a single request. The user only sees `insertedCount /
   dedupSkipped / totalLines` **after** the transaction has committed —
   there is no chance to sanity-check what's about to land in the
   ledger.
3. **Errors can't be retried without re-picking.** After a batch,
   `UploadForm.submit` clears `setFiles([])` (line 193) and the summary
   only carries error *filenames*, not the `File` objects. A transient
   failure means the user must re-open the file dialog and re-select.

## Goal

Make the initial upload feel less "click and pray" and let a failed
batch item be re-tried in place, without changing anything about how
parsing, dedup, categorization, or transfer detection works today.

## Non-goals

- **No new file formats.** No QIF, MT940, Excel, JSON. That is
  sub-project **A** and gets its own spec cycle.
- **No new sources / connectors.** No bank APIs, IMAP, folder watchers.
  That is sub-project **B**; it collides with the LAN-only deployment
  and needs its own design.
- **No per-file account picker.** The current "one account for the
  whole batch" limitation stays. Adding a per-row account column is
  desirable but out of scope here — batch uploads today are usually
  same-account and the added complexity isn't justified for this pass.
- **No preview for PDFs or photos.** PDFs already have the template
  wizard as a preview+confirm step (`PdfTemplateWizard.tsx`), and
  photos go through the same wizard after OCR. Adding a second preview
  layer would be redundant.
- **No preview in batch mode.** Preview only runs on **single-file
  OFX/CSV** uploads. A batch commits directly, same as today.
- **No auto-retry, no exponential backoff, no row-level retry.** Retry
  is a manual per-file re-attempt.

## Architecture — three isolated slices

The three improvements are independent. They can be implemented and
merged in any order. Each has a well-defined boundary and can be tested
on its own.

### Slice 1 — Drag-and-drop zone

**Frontend only.** Wrap the existing "Fichier(s)" input in
`UploadForm.tsx` with a dashed drop target. The current file input,
folder picker, submit button, and account dropdown all stay exactly as
they are — drop is additive.

- Accepts files from Finder/Explorer or a folder drag. Folder drops
  recurse through subdirectories via
  `DataTransferItem.webkitGetAsEntry` — same behavior the existing
  `webkitdirectory` folder picker already provides, kept symmetrical
  on purpose. If the browser doesn't expose `webkitGetAsEntry`, folder
  drops are ignored and the user falls back to the folder-pick button.
- Applies the existing `acceptFile(name)` predicate (line 38) to drop
  entries. Files with unsupported extensions are silently dropped, same
  as when a folder pick includes `.DS_Store`.
- On drop, calls the same `pickFiles(list)` handler the file input
  already uses, so downstream state (`setFiles`, `setError(null)`,
  `onFileSelected()`) is untouched.
- Visual: dashed border around the file-picker sub-column. Hover state
  when dragging over it. Not full-page — a full-page drop target
  hijacks unrelated drags (a common annoyance).
- Photo input stays where it is, in its own bottom section. It targets
  a different backend path (`submitPhoto`) and mixing the two would
  confuse the UX.

### Slice 2 — Preview before import (OFX/CSV, single file)

**New backend endpoint + new frontend modal.**

**Backend — `POST /api/imports/preview`**

- Same multipart shape as `POST /api/imports`: one `file` part, an
  optional `accountId` query param.
- Resolves the format via `inferFormat(filename)`. Rejects `pdf` with a
  400 (`preview not supported for PDF, use the template wizard`).
  Rejects unknown formats the same way `/api/imports` does today.
- Resolves the account: same priority as the real import — explicit
  `accountId` wins, otherwise `resolveAccountFromFilename`. If neither
  resolves, returns a 400.
- Parses the buffer with the existing `parseFile(buf, format)` in
  `backend/src/domain/imports/import-service.ts:55` — no restructuring
  needed; that function is already side-effect-free.
- For each parsed row, computes `dedupKey` with the existing
  `computeDedupKey` helper.
- Runs one `SELECT dedup_key FROM transactions WHERE account_id = ? AND
  dedup_key IN (…)` to identify which rows would collide with existing
  transactions.
- Returns:

  ```json
  {
    "filename": "…",
    "format": "ofx" | "csv",
    "accountId": 123,
    "totalRows": 42,
    "newRows":       [{ "date": "…", "amount": "…", "rawLabel": "…", "memo": "…" }],
    "duplicateRows": [{ "date": "…", "amount": "…", "rawLabel": "…" }]
  }
  ```

- **No `fileImports` row is created.** No transactions are inserted.
  The endpoint is a pure read.

**Frontend — `UploadForm.submit` (OFX/CSV single-file path only)**

- The OFX/CSV branch (currently lines 122–142) changes: instead of
  posting to `/api/imports`, post to `/api/imports/preview` and open a
  new `ImportPreviewModal`.
- Modal contents:
  - Header: filename, resolved account, summary line — `N nouvelles ·
    M dédupliquées / total T`.
  - Table (Date · Libellé · Montant · État where État is "Nouveau" or
    "Doublon"). Duplicate rows rendered muted.
  - Rows collapsible past 100 (a "voir tout" toggle) — keeps the modal
    responsive on large OFX files.
- Two actions:
  - **Importer** — calls the real `POST /api/imports` with the same
    `File` object still held in state. Server parses again; this is
    intentional (no server-side temp files, keeps the endpoint
    stateless, fits the single-box LAN deployment).
  - **Annuler** — closes the modal, keeps the file selected so the
    user can adjust the account and re-preview.
- On successful import, existing behavior: banner shows counts,
  `invalidateAll()` refreshes queries, file input clears.
- **PDF single-file, photo, and batch (>1 file) paths all skip the
  preview modal.** They keep today's behavior verbatim.

**Why re-upload instead of caching the parsed buffer server-side:**
caching would require a temp file, a TTL, a cleanup job, and
identifying which parse belongs to which user across requests. For an
OFX file (typically <500 rows, tens of KB), re-parsing on confirm is
cheap and keeps the endpoint stateless. The LAN-only single-user
deployment further removes any argument for the caching complexity.

### Slice 3 — Retry failed items from the summary

**Frontend only.**

- Change the `errors` shape on the `batch` state from `{ file: string;
  message: string }[]` to `{ file: File; message: string }[]` — retain
  the `File` object, not just its name.
- After a batch completes (`UploadForm.tsx:191–194`), do **not** drop
  the failed `File` objects on the floor. The successful path still
  clears the file input; only the failed items are retained on the
  summary state.
- Summary panel changes (currently `UploadForm.tsx:298–311`):
  - Each error row grows a **↻ Réessayer** button.
  - Under the list of errors, a **Réessayer tout** button (only shown
    when 2+ errors exist).
  - Clicking retry runs the exact same per-file dispatch used in the
    original batch loop (lines 156–188): PDF → `submitPdf` (with the
    wizard fallback if `kind === 'needs_template'`); OFX/CSV →
    `apiUpload('/api/imports', …)`. **No preview modal for retries**,
    even for OFX/CSV — the user has already decided this file should
    import; a re-attempt is a re-attempt, not a fresh decision.
  - A successful retry: removes the entry from `batch.errors`, adds
    its counts to `batch.imported / inserted / skipped`, calls
    `invalidateAll()`.
  - A failed retry: replaces the message in place, does not append a
    duplicate row.
- **Fermer** clears the summary state entirely, releasing the retained
  `File` objects to GC — same as today, just now also drops the
  retained files.

## Data flow

```
┌─────────────────────────────────────────────────────────────┐
│  User picks/drops files                                      │
│  (Slice 1: drop → same pickFiles handler)                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
              ┌────────┴────────┐
              │ files.length?   │
              └────┬───────┬────┘
              1 file       >1 file (batch)
                 │            │
      ┌──────────┴───┐        │
      │ format?      │        │
      └──┬──┬────┬───┘        │
       PDF  OFX  CSV          │
        │    └────┴──┐        │
        │            │        │
        │      ┌─────┴────────┴──┐
        │      │ Slice 2:         │  Slice 2 does NOT run
        │      │ POST /preview    │  for batches or PDFs.
        │      │ → modal          │
        │      │ → Importer?      │
        │      └─────┬────────────┘
        │            │
        │            ▼
        ▼      ┌────────────────────────┐
    submitPdf  │ POST /api/imports      │
    (existing) │ (existing behavior)    │
        │      └────────┬───────────────┘
        │               │
        └───────┬───────┘
                ▼
        ┌────────────────────────────┐
        │ Batch summary panel        │
        │ (Slice 3: errors retain    │
        │  File objects + retry btn) │
        └────────────────────────────┘
```

## API surface — full delta

**New**

| Method | Path                    | Body                                            | Response                                        |
| ------ | ----------------------- | ----------------------------------------------- | ----------------------------------------------- |
| POST   | `/api/imports/preview`  | multipart: `file`; query: optional `accountId`  | `{ filename, format, accountId, totalRows, newRows[], duplicateRows[] }` |

**Unchanged**

- `POST /api/imports` — same behavior. The confirm step in Slice 2
  posts here as it does today.
- `POST /api/imports/pdf/*`, `POST /api/imports/photo/*` — untouched.

## Error handling

- **Preview endpoint**
  - Missing/malformed file → 400 with the same message shape
    `/api/imports` uses today.
  - PDF sent to `/preview` → 400 `preview not supported for PDF, use
    the template wizard`.
  - Parser throws → 400 with the parser's message (mirrors current
    behavior).
  - No account resolvable → 400 `no destination account (pass
    accountId or configure a filename pattern)`.

- **Preview modal**
  - Network failure on preview → error banner in the modal; **Réessayer
    la prévisualisation** button; user can close and retry from the
    form.
  - Network failure on confirm → same error handling as today's
    OFX/CSV path (`setError`, modal closes so the file stays picked).

- **Retry**
  - Failed retry → message updated in place. No cascading error state.
  - PDF retry that hits `needs_template` — opens the wizard (same as
    the original batch path deferred it into the "needs template"
    list; on retry the user can walk through the wizard interactively
    because there's no longer a queue behind it). The failed error
    row stays in `batch.errors` until the wizard flow completes
    successfully; on wizard success it's removed and the counts are
    added, on wizard cancel it stays with its original message.

## Testing

Each slice is testable in isolation:

- **Slice 1** — component test on `UploadForm`: firing a synthetic
  `drop` event with a mock `DataTransfer` populates `files` the same
  way a click on the input does. One test for a file drop, one for a
  folder-entry drop (mock `webkitGetAsEntry`), one for a mixed drop
  where junk files (`.DS_Store`) are filtered.
- **Slice 2 — backend** — integration test on the new endpoint:
  parses a fixture OFX and CSV, asserts `newRows` / `duplicateRows`
  split against a pre-seeded ledger, asserts no `fileImports` or
  `transactions` rows were created. One test each for PDF-rejection,
  missing-file, unresolvable-account.
- **Slice 2 — frontend** — component test on the new
  `ImportPreviewModal`: renders counts, splits new vs duplicate rows,
  Importer calls `apiUpload('/api/imports', …)`, Annuler closes.
- **Slice 3** — component test on `UploadForm` summary: seed a `batch
  = { phase: 'done', errors: [{ file, message }] }`, click Réessayer,
  assert `apiUpload` is called with the retained `File` and the error
  row is removed on success / updated in place on failure.

## Deferred (explicit non-scope)

- **A — New file formats.** QIF, MT940, Excel, JSON backup, new bank
  CSV/PDF dialects. Bounded parser work. Separate spec cycle.
- **B — New sources / connectors.** Bank APIs (Bridge, Powens,
  GoCardless), IMAP watching, folder watching. Non-trivial because of
  the LAN-only deployment (public HTTPS callback URLs) and the
  no-secrets-in-repo constraint (needs a runtime secret store).
  Separate spec cycle.
- **Per-file account picker.** Would fix the "all PDFs share one
  account" limitation but adds a table-shaped selection UI. Punt until
  someone actually asks for it.
- **Preview for PDFs / photos.** Redundant with the template wizard.
