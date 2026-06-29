# PDF bank statement import — design

**Status:** Draft (awaiting user review)
**Date:** 2026-06-29
**Scope:** v1 — text-layer PDFs only; scanned PDFs deferred (OCR is out of scope).

## Goal

Let the user upload a bank statement in PDF format and have its transactions land in the same `transactions` table as OFX/CSV imports, going through the existing normalize → dedup → categorize chain. When the layout cannot be parsed automatically, the user paints zones once and the app remembers them; subsequent statements with the same layout import without any clicks.

## Non-goals (v1)

- OCR for scanned/image-only PDFs. The pipeline detects this case and surfaces it clearly, but does not run Tesseract. Revisit once a real scanned statement shows up.
- LLM-assisted parsing (Ollama or otherwise). LLMs hallucinate amounts; not acceptable in an accounting database.
- Cross-user template sharing. Single-user app today; templates are global to the install.

## High-level pipeline

```
POST /api/imports (multipart)
  ├─ existing branches: .ofx / .csv / .qfx
  └─ new branch: .pdf
        1. pdfjs-dist  → TextItem[] with (page, x, y, w, h, str)
        2. fingerprint(textItems) → sha256 hash of normalized header region
        3. lookup pdf_statement_templates WHERE fingerprint = $1
        4a. hit  → apply template zones → NormalizedTransaction[]
        4b. miss → run heuristic
              - confidence ≥ 0.9 → extract + silently save inferred template
              - confidence <  0.9 → park a pdf_import_drafts row, return
                                    { status: "needs_template", ... } to the client
        5. hand off to existing normalize → dedup → insert chain
```

The PDF branch produces the exact same `NormalizedTransaction[]` shape as the OFX/CSV parsers, so everything downstream (dedup keys, rule engine, transfer detection, reports) is unchanged.

## Data model

Two new tables; nothing else in the schema is touched.

```sql
-- One row per learned bank layout. Keyed by content fingerprint, not account,
-- so the same template applies to every account on the same bank.
CREATE TABLE pdf_statement_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint   text NOT NULL UNIQUE,
  label         text NOT NULL,                -- e.g. "BNP — Compte Chèques"
  zones         jsonb NOT NULL,               -- shape below
  source        text NOT NULL CHECK (source IN ('heuristic','interactive')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- A PDF upload parked while the user paints zones. Short-lived.
CREATE TABLE pdf_import_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pdf_bytes     bytea NOT NULL,
  text_items    jsonb NOT NULL,               -- cached pdfjs output
  fingerprint   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX ON pdf_import_drafts (expires_at);
```

`zones` jsonb shape:

```ts
type Zones = {
  // Region used to fingerprint the PDF. Stored so retraining can recompute it.
  headerZone: { page: number; x: number; y: number; w: number; h: number };

  // Rectangle covering the transaction table on a representative page.
  tableZone: { page: number; x: number; y: number; w: number; h: number };

  // Whether the table repeats on every page or appears only on tableZone.page.
  tableRepeatsPerPage: boolean;

  // Column boundaries, in page coordinates, within tableZone.
  columns: Array<{
    xStart: number;
    xEnd: number;
    role: "date" | "amountSigned" | "debit" | "credit" | "description" | "ignore";
  }>;

  // Y-offset (from top of tableZone) below which actual rows start. Skips header rows.
  rowsStartY: number;
};
```

Constraints enforced at the API layer (not in SQL — keeps the schema simple):
- exactly one column with `role === "date"`
- exactly one column with `role === "description"`
- either exactly one `role === "amountSigned"` OR exactly one each of `"debit"` and `"credit"`

A `pg_cron` or app-level sweeper deletes `pdf_import_drafts WHERE expires_at < now()`. App-level (a cheap startup + hourly job in Fastify) is simpler than introducing pg_cron — go with that.

## Fingerprint

`sha256(normalize(textItemsInHeaderZone))` where `normalize` strips:
- all digits (filters out dates and account numbers that change month-to-month)
- all whitespace runs (collapses to single spaces)
- accents (NFKD + strip combining marks)
- case (toLowerCase)

This stays stable across statements from the same bank+layout, and distinct between banks. Collisions across banks would mean two banks render identical headers after that normalization — vanishingly unlikely; if it ever happens the user just gets prompted to paint zones, which is the same recovery as a fresh template.

`headerZone` defaults to `{ page: 1, x: 0, y: 0, w: pageWidth, h: pageHeight * 0.15 }` on first import. The interactive flow lets the user adjust it if needed (rarely).

## Heuristic extractor

Pure function: `TextItem[]` → `{ zones: Zones, rows: NormalizedTransaction[], confidence: number }`.

1. **Row clustering**: group `TextItem`s by Y-coordinate within ±2pt → candidate rows.
2. **Column inference**: for each candidate row, list its X-bands. Find the column where ≥80% of rows match `^\d{2}/\d{2}/(?:\d{2}|\d{4})$` → `date`. Find the column(s) where ≥80% match `^-?\d{1,3}(?: \d{3})*,\d{2}$` → either `amountSigned` (single col) or `debit`+`credit` (two cols side-by-side, never both populated in the same row). The widest remaining column → `description`.
3. **Table top**: first row containing an accent-insensitive match of `Date` as a header word, or the first row with a parsable date if no header is found. Set `rowsStartY` to just below it.
4. **Confidence** = `count(rows where date AND amount both parse cleanly) / count(rows in detected table area)`.
5. If confidence ≥ 0.9: emit rows, persist template with `source='heuristic'`.
6. If 0.5 ≤ confidence < 0.9: return the inferred zones as `suggestedZones` to pre-fill the interactive UI.
7. If confidence < 0.5: return `suggestedZones: null`, user paints from scratch.

The threshold and clustering tolerance are constants in `backend/src/domain/imports/pdf-heuristic.ts`; tunable but not configurable from the UI.

## Interactive template builder

When the backend returns `{ status: "needs_template" }`, the response includes:

```ts
{
  status: "needs_template",
  importDraftId: string,
  fingerprint: string,
  pages: Array<{ pageNumber: number; pngBase64: string; widthPt: number; heightPt: number }>,
  textItems: TextItem[],              // for column-boundary auto-suggest in the UI
  suggestedZones: Zones | null        // pre-filled if heuristic had medium confidence
}
```

Page rendering: backend uses `pdfjs-dist`'s page renderer drawing onto a `@napi-rs/canvas` context to rasterize each page to PNG at 150 DPI. PNGs are sent inline as base64 in the response — drafts are small (a few pages) and this avoids a second authenticated round-trip per page.

Modal flow, three steps:

1. **Header zone**. Page 1 renders with a draggable/resizable rectangle pre-positioned at the top 15%. User confirms. This rectangle defines the fingerprint and is reused on every future import from the same bank.
2. **Table zone**. User picks a representative page (defaults to the page with the most numeric content), drags a rectangle around the transaction table. Toggle: *"This table repeats on every page"* (default on).
3. **Column mapping**. Inside the table rectangle, the modal overlays vertical guides at every detected X-cluster from `textItems`. User clicks each column to label it from a dropdown: Date / Amount (signed) / Debit / Credit / Description / Ignore. The modal validates the constraint set (exactly-one Date, exactly-one Description, one Amount-signed OR one Debit + one Credit) and only enables Submit when satisfied.

On submit: `POST /api/imports/pdf/templates` with `{ importDraftId, label, zones }`. Backend persists template, applies it to the draft, deletes the draft, returns the standard import summary.

Rationale for *column-mapping once* rather than *field-clicking per row*: a statement is a table with N rows; asking once per column generalizes to all rows. That is the actual feature value the user described as "the soft learn the template of this document".

## API surface

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/imports` | Existing. New `.pdf` branch. Returns `{ imported: { inserted, deduped, skippedRows? } }` on success or `{ needsTemplate: {...} }` when zones must be painted. |
| `POST` | `/api/imports/pdf/templates` | Body: `{ importDraftId, label, zones }`. Saves template, applies to draft, returns import summary. Idempotent on `fingerprint` via `ON CONFLICT DO UPDATE`. |
| `GET` | `/api/pdf-templates` | List learned templates `[{ id, fingerprint, label, source, createdAt }]`. |
| `PUT` | `/api/pdf-templates/:id` | Rename label or update zones (manual retrain). |
| `DELETE` | `/api/pdf-templates/:id` | Forget a template — next import of that PDF format will go through the interactive flow again. |

All endpoints sit behind the existing session-cookie auth plugin. No changes to auth or onboarding.

## Error handling

| Failure | Behavior |
|---------|----------|
| PDF has no text layer (scanned image) | Heuristic returns 0 rows. Frontend gets `needsTemplate` with a banner: *"This PDF appears to be a scan. Zone selection works, but row extraction will be empty — OCR isn't available yet."* If the user submits anyway, apply returns 422 `{ code: "scan_no_text" }` rather than silently inserting nothing. |
| Encrypted PDF | 400 `{ code: "pdf_encrypted" }`. |
| File > 10 MB | 413 `{ code: "pdf_too_large" }`. |
| Heuristic confidence 0.5–0.9 | Treat as miss → interactive flow with `suggestedZones` pre-filled. |
| Heuristic confidence < 0.5 | Interactive flow with `suggestedZones: null`. |
| Template applies but yields 0 rows | 422 `{ code: "template_yielded_no_rows" }`. Template is *not* overwritten. UI suggests retraining. |
| Template applies but a row has unparseable date/amount | Skip the row, include it in `skippedRows: [{ rowText, reason }]`. Skipping > 5% of rows surfaces a "retrain?" hint in the UI. |
| Concurrent submits with the same fingerprint | `INSERT … ON CONFLICT (fingerprint) DO UPDATE`. Single-user app; this is defensive only. |
| Draft expired (>24h) | 410 `{ code: "draft_expired" }`. User re-uploads the PDF. |

## Testing

Three layers, mirroring the existing OFX/CSV tests in `backend/tests/imports/`:

1. **Unit tests** — `backend/tests/imports/pdf-heuristic.test.ts`. Feed synthetic `TextItem[]` arrays (no PDF files) covering: signed amounts, débit/crédit pairs, multi-page tables, header-only pages, accented column names (`Débit`/`Crédit`/`Libellé`), French amount format (`1 234,56`), two- and four-digit years. Assert detected columns + row count + parsed values.

2. **Fixture tests** — `backend/tests/fixtures/pdf/*.pdf` with 3–5 anonymized real PDFs (user provides; a `README.md` in the fixtures folder documents the anonymization procedure). Test runs full pipeline: parse → fingerprint → heuristic → normalize. Each fixture is one bank format the user actually imports from.

3. **Round-trip test** — take fixture A, run heuristic, capture the zones it produced, save as a template, re-import the same fixture going through the template path. Assert the resulting `NormalizedTransaction[]` is byte-identical to the heuristic path. Catches drift between heuristic and template-apply.

Frontend interactive flow: manual QA for v1. Canvas overlay is ~150 LOC; a Playwright test is more code than the feature. Revisit when the modal grows.

## Libraries & footprint

- **Backend (new)**: `pdfjs-dist` (~2 MB, MIT, runs in Node) for text extraction with positions and page rendering; `@napi-rs/canvas` to provide the canvas surface `pdfjs-dist` renders onto.
- **Frontend (new)**: none. Native `<canvas>` element + React state for the zone painter. The backend ships PNGs; the frontend draws rectangles on top.
- **No OCR dependency, no LLM dependency, no cloud calls.** Consistent with the README's "your bank data never leaves your network" guarantee.

## Migration

One new SQL migration file at `backend/src/db/migrations/NNN_pdf_import.sql` adding both tables. Hand-written to match the existing migration style (no Drizzle journal).

## Open questions

None for v1. OCR, multi-account templates, and LLM category suggestion are deferred to a v2 design if needed.
