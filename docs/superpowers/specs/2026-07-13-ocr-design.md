# OCR — scanned PDFs + statement photos

**Date:** 2026-07-13
**Status:** Approved (design)
**Type:** Import pipeline extension

## Summary

Let users import bank statements from two sources that don't have a text
layer today: scanned PDFs (paper statement digitized) and phone photos
of paper statements. Both feed the existing PDF-wizard machinery (render
→ paint zones → preview → import) with one new pixel-to-text step
(server-side Tesseract.js) that produces recognized words with the same
`(xLeft, yTop, width, height, text)` shape the wizard already consumes
from `pdfjs`. An editable preview lets the user hand-fix OCR misreads
before the rows land.

## Goals

- Kill the current dead-end for scanned PDFs (the wizard opens today
  with a red banner saying "OCR isn't available").
- Add photos as a first-class import format (JPEG, PNG, HEIC) without
  duplicating the wizard.
- Keep the entire pipeline server-side and local-only — no cloud OCR,
  matches the project's LAN-only Geekom deployment policy.
- Give the user a chance to correct recognition errors inline before
  importing, so a single misread doesn't cost a re-import loop.

## Non-goals (v1)

- Per-zone OCR (crop each painted zone, OCR each crop independently) —
  higher accuracy on narrow columns but more code; deferred.
- Full-page OCR + regex (skip zones entirely) — loses the wizard's
  layout-anchored reliability; deferred.
- Client-side OCR in the browser — mobile devices struggle, splits the
  pipeline in half.
- Template caching for photos — photos vary too much (framing, lighting,
  crop) for a stable fingerprint. Every photo import paints zones from
  scratch.
- Permanent full-size image storage. The photo bytes live only in the
  wizard draft (base64 in `pdf_import_drafts.pdf_bytes`) and are dropped
  when the draft is cleaned up, same as PDFs today.
- LLM-based structured extraction (nuextract etc.) — GPU/big-model
  install overhead unwarranted for a homelab tool.

## Decisions (from brainstorming)

- **Scope:** scanned PDFs and photos together, single spec.
- **Engine:** `tesseract.js` (pure Node, no system binary). Language
  pack `fra+eng` by default (~40 MB shipped via npm).
- **Extraction shape:** OCR whole page → produce word list → filter into
  the existing zones. Reuses `parseStatementRows` unchanged; only the
  source of the item list differs (`OcrWord` instead of `PdfTextItem`,
  same fields).
- **Preview:** editable table (rows as inputs) with per-row OCR
  confidence badges; server accepts `override_rows` on the final import
  call.
- **Photo storage:** treated like PDFs — base64 in the draft, discarded
  after import.
- **Photo templates:** no caching.
- **OCR execution:** server-side, async — upload response returns
  immediately with `ocrStatus: 'pending'`; the wizard polls a status
  endpoint until `'ready'`.

## Backend

### OCR module

New at `backend/src/domain/imports/ocr/index.ts`:

```ts
export interface OcrWord {
  xLeft: number; yTop: number; width: number; height: number;
  text: string; confidence: number;   // 0..1
}
export interface OcrPage {
  pageIndex: number; widthPx: number; heightPx: number;
  words: OcrWord[]; meanConfidence: number;
}
export function ocrPngPages(
  pngBase64Pages: string[],
  opts?: {
    lang?: 'fra' | 'eng' | 'fra+eng';
    onPageDone?: (pageIndex: number, total: number) => void;
  },
): Promise<OcrPage[]>;
```

- One `createWorker()` per call, terminated in a `finally`. Workers are
  not process-shared: keeps memory flat and avoids leaked state between
  imports.
- Default language `fra+eng`. Both packs load on first use of a worker.
- `OcrWord.confidence` is Tesseract's 0–100 score divided by 100.
- Pages OCR'd **sequentially** — the Geekom's dual-core doesn't benefit
  from parallel workers on a CPU-bound task.
- New backend dep: `tesseract.js@^5.0` (adds `tesseract.js-core` — the
  WASM binary + trained data files).

### Photo module

New at `backend/src/domain/imports/photo/index.ts`:

```ts
export async function importPhoto(opts: {
  filename: string; accountId: number; userId: number; buffer: Buffer;
}): Promise<ImportPdfResult>;
```

Returns the same `ImportPdfResult` union as `importPdf` (`kind:
'needs_template'` in v1 — photos always land in the wizard). Behavior:

- MIME sniff (magic bytes) — accept `image/jpeg`, `image/png`,
  `image/webp`, `image/heic`. Reject anything else with `400`.
- Size cap 25 MB (typical iPhone photo is 3–8 MB).
- HEIC → JPEG transcode via `sharp` (new backend dep, native binaries
  bundled per-arch). Applied only when the input is HEIC.
- Produces one `RenderedPage` from the JPEG/PNG bytes (uses
  `@napi-rs/canvas` decode + re-encode to PNG so downstream `renderPagesToPng`
  consumers stay unchanged).
- Creates a `pdf_import_drafts` row with `source_kind: 'photo'`,
  `fingerprint: ''`, `ocr_status: 'pending'`, `ocr_total: 1`, then kicks
  off the OCR job.

### Draft schema — migration `0020_pdf_draft_ocr.sql`

```sql
ALTER TABLE pdf_import_drafts
  ADD COLUMN source_kind text NOT NULL DEFAULT 'pdf',
  ADD COLUMN ocr_status  text NOT NULL DEFAULT 'not_needed',
  ADD COLUMN ocr_progress integer NOT NULL DEFAULT 0,
  ADD COLUMN ocr_total    integer NOT NULL DEFAULT 0,
  ADD COLUMN ocr_error    text;
```

`ocr_status` values: `'not_needed' | 'pending' | 'ready' | 'error'`.
`source_kind` values: `'pdf' | 'photo'`. No `CHECK` constraint (app-layer
Zod at every write site).

### Async OCR job

Kicked off inside the upload handler using `queueMicrotask` (small,
inline; no new job registry, no BullMQ). Job:

1. Reads the draft's `pdf_bytes` (base64), decodes, renders pages to PNG
   if not already (PDFs skip render; photos already have PNG from
   `importPhoto`).
2. Calls `ocrPngPages(pages, { onPageDone: (i, n) => update ocr_progress = i+1 })`.
3. On success: writes the recognized words into the draft's `text_items`
   JSONB column (same column pdfjs items live in today), sets
   `ocr_status = 'ready'`, `ocr_progress = ocr_total`.
4. On failure: sets `ocr_status = 'error'`, `ocr_error = err.message`.

Because the job runs in the same process, a Node restart mid-OCR leaves
the draft in `pending` forever. Draft-sweeper (existing) treats
`ocr_status = 'pending'` older than 10 minutes as stale and reaps the
draft. UI shows "L'analyse s'est interrompue — relancez l'import" when
polling hits that state (via a 410 on `GET /api/imports/pdf/drafts/:id`).

### Upload response

`POST /api/imports/pdf` (existing route) — when `noText` is true, the
`parkDraft` path returns:

```jsonc
{
  "kind": "needs_template",
  "draftId": 42,
  "reason": "no_text_layer",
  "fingerprint": "",
  "pages": [ /* PNG bytes */ ],
  "textItems": [],                        // empty until OCR completes
  "sourceKind": "pdf",
  "ocrStatus": "pending",
  "ocrTotal": 5
}
```

For text-PDFs the response is unchanged (`ocrStatus: 'not_needed'`,
`ocrTotal: 0`).

`POST /api/imports/photo` (new route) — same shape,
`sourceKind: 'photo'`, `ocrTotal: 1`.

### Status endpoint

New: `GET /api/imports/pdf/drafts/:id/ocr-status`.

Response `200`:

```jsonc
{
  "status": "pending" | "ready" | "error",
  "progress": 3,
  "total": 5,
  "meanConfidence": 0.87,        // only when status === 'ready'
  "error": "…"                   // only when status === 'error'
}
```

`404` if the draft doesn't exist OR belongs to another user (same
opaque response — matches the project's non-enumeration pattern).

### Import with row overrides

`POST /api/imports/pdf/templates/:draftId/import` extends to accept an
optional `override_rows` array. Server-side Zod:

```ts
override_rows: z.array(z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().min(1).max(200),
  amount: z.string().regex(/^-?\d+([.,]\d{1,2})?$/),
})).optional();
```

When present, `runImport` receives `override_rows` directly instead of
re-parsing from `text_items` + zones. Legacy text-PDF flow (no
`override_rows`) unchanged.

## Frontend

### UploadForm changes

`frontend/src/pages/Imports/UploadForm.tsx` gains a second input group,
positioned right below the existing PDF/OFX/CSV group:

- Label: `Photo (JPEG, PNG, HEIC)`.
- Input: `<input type="file" accept="image/jpeg,image/png,image/webp,image/heic" />`.
- Same "Compte cible" selector reused.
- Submit POSTs to `/api/imports/photo`. On `needs_template` response,
  opens the `PdfTemplateBuilder` modal (already the case for PDFs).

### PdfTemplateBuilder — new leading step

New file `frontend/src/components/PdfTemplateBuilder/OcrProgress.tsx`:

```tsx
export function OcrProgress({ draftId, onReady, onError }: {
  draftId: number;
  onReady: () => void;
  onError: (msg: string) => void;
}): JSX.Element;
```

- Polls `GET /api/imports/pdf/drafts/:id/ocr-status` every 1 s via
  `useQuery({ refetchInterval: 1000 })`.
- Renders a centered progress bar with `{progress} / {total} pages`.
- On `status === 'ready'`, calls `onReady()` (parent transitions to the
  `header` step and refetches the draft to get the new `text_items`).
- On `status === 'error'`, calls `onError(msg)` (parent shows an inline
  banner + close button).

`PdfTemplateBuilder/index.tsx`:

- Remove the current "OCR n'est pas encore disponible" banner (line
  ~240).
- Add a new step key `ocr-progress` that renders `<OcrProgress />`
  before `'header'` when `ocrStatus === 'pending'`.
- Header title copy switches on `sourceKind`:
  - `'pdf'` + no OCR → "Configurer le PDF" (current).
  - `'pdf'` + OCR path → "Configurer le PDF scanné".
  - `'photo'` → "Configurer la photo".

### Editable preview table

New file `frontend/src/components/PdfTemplateBuilder/PreviewTable.tsx`:

```tsx
export interface PreviewRow {
  date: string; label: string; amount: string;
  confidence?: number;   // 0..1, min over the row's cells; absent on text-PDF path
}
export function PreviewTable({
  rows, editable, onChange, onDelete, onImport, importing,
}: {
  rows: PreviewRow[];
  editable: boolean;
  onChange?: (index: number, patch: Partial<PreviewRow>) => void;
  onDelete?: (index: number) => void;
  onImport: () => void;
  importing: boolean;
}): JSX.Element;
```

- Columns: Date, Libellé, Montant. When `editable === true`, each cell
  is an `<input>` pre-filled with the OCR value; when `false`, plain
  text spans (matches the current text-PDF preview).
- A confidence dot per row when `rows[i].confidence` is present: green
  (≥ 0.85), amber (0.65–0.84), red (< 0.65). Column hidden entirely
  when no row carries a confidence (text-PDF case).
- Amount input validates `^-?\d+([.,]\d{1,2})?$`; invalid values get a
  subtle red border. Date input validates `^\d{4}-\d{2}-\d{2}$`.
  Validation runs only when `editable`.
- Delete button (`×`) at row end when `editable === true` — removes the
  row from the list via `onDelete`.
- `Importer` button disabled while any row's `date` or `amount` is
  invalid (only checked when `editable`), or while `importing` is true.
- Text-PDF `Aperçu` panel keeps its current read-only behavior: mounts
  `<PreviewTable editable={false} ... />`. The existing preview flow
  (via `POST /api/imports/pdf/templates/preview`) is unchanged — OCR
  path is the only one that flips `editable` on and passes
  `override_rows` at import time.

`PdfTemplateBuilder`: when the user clicks `Aperçu` on the last wizard
step and `sourceKind !== 'pdf'` OR `ocrStatus === 'ready'` (i.e. OCR
path), the panel that renders the preview is `<PreviewTable>`. Import
button now sends `override_rows` = current rows in the table.

## Testing

### Backend

- `backend/src/domain/imports/ocr/__tests__/ocr.test.ts` (ungated):
  fixture PNG generated via `@napi-rs/canvas` with rendered text like
  `"2026-06-14 CARREFOUR -34,20"`. Assert `ocrPngPages([png])` returns
  words with expected `text` values, `xLeft`/`yTop` bands, and
  `confidence > 0.5`. Also cover empty-image → 0 words, non-PNG →
  thrown error.
- `backend/src/domain/imports/photo/__tests__/photo.test.ts` (ungated):
  MIME sniff (JPEG magic `FF D8 FF`, PNG signature `89 50 4E 47`, HEIC
  `ftyp` box marker); size cap rejects at 25 MB + 1 byte; HEIC → JPEG
  transcode round-trip (bytes in, JPEG out via `sharp`).
- `backend/tests/imports-route.test.ts` (DB-gated) extends:
  - `POST /api/imports/photo` accepts a small JPEG fixture, returns
    `needs_template` with `sourceKind: 'photo'`, `ocrStatus: 'pending'`.
  - `POST /api/imports/photo` rejects `application/pdf` bytes with 400.
  - `GET /api/imports/pdf/drafts/:id/ocr-status` returns pending → ready
    as the background job progresses (test polls with `wait-for`).
  - `POST /api/imports/pdf/templates/:draftId/import` with
    `override_rows: [...]` produces exactly those transactions (bypasses
    zone parsing).
- The OCR module itself is stubbed in the DB-gated route test — the
  real Tesseract stays behind the ungated `ocr.test.ts` (slow but
  isolated).

### Frontend

- `PdfTemplateBuilder/__tests__/OcrProgress.test.tsx`: mock the polling
  endpoint, assert the progress bar updates, transition to header step
  on `ready`, banner on `error`.
- `PdfTemplateBuilder/__tests__/PreviewTable.test.tsx`: 3 rows with
  mixed confidences → dot color per row; amount input reddens on
  `12,3.4`; delete removes the row; Importer disabled when any amount
  invalid.
- `Imports/__tests__/UploadForm.test.tsx` extends: photo input group
  present; submitting a photo POSTs to `/api/imports/photo`; PDF still
  POSTs to `/api/imports/pdf`.
- `PdfTemplateBuilder/__tests__/index.test.tsx` extends: opening on a
  draft with `ocrStatus: 'pending'` shows the OCR progress screen; on
  `ready` goes straight to `header`; the old "OCR not available" banner
  no longer appears.

### Manual smoke (before commit)

1. Upload a real scanned PDF (no text layer) → progress bar → paint
   zones → preview → edit one row → import → verify transactions
   landed.
2. Upload a phone photo of a paper statement → same flow.
3. Upload a normal text-PDF → OCR path skipped (`ocrStatus:
   'not_needed'`), existing flow unchanged.
4. Upload a 30 MB image → 400 response.
5. Cancel the wizard mid-OCR → draft cleanup on next sweep (or manual
   sweeper run).

## Open questions / follow-ups

- **Per-zone OCR** — a v2 quality bump for narrow amount columns.
  Deferred.
- **Photo template caching** — if the user ends up scanning the same
  paper statement monthly, revisit named templates ("Modèles photo").
  Deferred.
- **Structured LLM extraction** (nuextract or similar) — evaluate once
  the Geekom gets more RAM/GPU. Deferred.
