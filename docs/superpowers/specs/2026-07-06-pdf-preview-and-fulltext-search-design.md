# PDF wizard preview + full-text search — design

_Draft: 2026-07-06_

## Goal

Two orthogonal small features bundled into one spec because they're both
one-day scoped and both live at the edges of existing surfaces.

1. **PDF wizard preview.** Before clicking « Importer » in the PDF
   template wizard, let the user see the transactions their painted zones
   would produce. Reduces the round-trip cost of iterating on a template
   for statements where the heuristic missed.
2. **Full-text search over transaction labels + notes.** The current
   `?search=` filter only matches `normalized_label`. Extend it to also
   match `raw_label`, `memo`, and `notes`, so queries like `netflix` on a
   transaction whose only "netflix" occurrence is in the user's own note
   still surface it.

Non-goals for v1:

- **Live preview auto-refresh on every zone change.** The user clicks
  « Aperçu » explicitly. Rationale: 1 backend call per volitional check
  keeps costs predictable, and the wizard's five painting steps already
  give plenty of interaction opportunities without a background job.
- **`tsvector` / dedicated FTS index.** `pg_trgm` is installed; the
  homelab DB stays under ~10k transactions per user; four OR'd
  `unaccent(lower(…)) LIKE …` clauses stay well under 30 ms on that
  scale. A generated column + GIN trigram index is a future migration
  if the seq scan starts to hurt.
- **Search operator syntax (`+`, `-`, quoted phrases).** V1 is plain
  substring match.

## Feature 1 — PDF wizard preview

### Backend

**New route**: `POST /api/imports/pdf/templates/preview` in
`backend/src/http/routes/imports.ts`, next to the existing
`POST /api/imports/pdf/templates`.

**Body**: `{ draftId: number, zones: TemplateZones }` — same shape as the
import route, so the frontend can send whatever it would submit if the
user clicked Importer instead.

**Handler flow**:

1. Auth via existing `preHandler`.
2. `validateZones(zones)` — throws → return 400.
3. `SELECT * FROM pdf_import_drafts WHERE id = :draftId`. If missing OR
   `expires_at < now()` OR `user_id !== req.user.id`, return
   `410 { code: 'draft_expired', error: 'draft expired or not found' }`.
   (Same semantics as the existing import route.)
4. Decode the base64 PDF bytes from the draft, call `extractText(buf)`.
5. Call `applyTemplate(pages, zones)` — the same pure function the
   import path uses. Returns `{ rows: ParsedTransaction[], skippedRows:
   {rowText, reason}[] }`.
6. Return `200 { rows, skippedRows }`.

**Explicit non-side-effects**: no `pdfStatementTemplates` upsert, no
`runImport`, no delete of the draft. The endpoint is idempotent and safe
to hammer.

**Zero-rows handling**: unlike the import route (which throws
`template_yielded_no_rows` on `rows.length === 0`), preview returns
`rows: []` with whatever diagnostic `skippedRows` gathered. The frontend
renders "0 lignes extraites" so the user sees *why* their zones aren't
matching without having to submit and get a 422.

**No anchor derivation**: `applyTemplateAndImport` currently stamps
`pageAnchor` / `otherAnchors` onto zones when they're missing. Preview
**does not** — it treats `zones` as the exact painted state and runs
`applyTemplate` on that. This means preview reflects what the *current
paint* would extract, not what a saved template would extract on future
statements. That's the right semantic: the user wants to check today's
extraction, and anchor derivation only kicks in on save.

### Frontend

**API helper**: new export in `frontend/src/api/pdf-templates.ts`:

```ts
export async function previewZones(
  draftId: number,
  zones: TemplateZones,
): Promise<{ rows: ParsedTransaction[]; skippedRows: SkippedRow[] }> {
  return api('/api/imports/pdf/templates/preview', {
    method: 'POST',
    json: { draftId, zones },
  });
}
```

`ParsedTransaction` and `SkippedRow` types live in the API layer already
(or are added there — check `pdf-templates.ts`).

**Component change**: in `frontend/src/components/PdfTemplateBuilder/index.tsx`:

- New local state:
  ```ts
  const [previewRows, setPreviewRows] = useState<ParsedTransaction[] | null>(null);
  const [previewSkipped, setPreviewSkipped] = useState<SkippedRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  ```
- Reset preview to `null` whenever any zone changes (tableRect, dateCol,
  descCol, signedCol, debitCol, creditCol, amountMode, headerRect,
  selectedPages, pickedAnchor, pickedOtherAnchors). Use a `useEffect`
  keyed on those values that clears `previewRows`, `previewSkipped`, and
  `previewError` — one hook rather than sprinkling `setPreviewRows(null)`
  through every `setX` call site.
- New handler `handlePreview()`: builds zones (same as `buildZones()`),
  calls `previewZones(draftId, zones)`, sets state accordingly.
- New button « Aperçu » rendered **only** in the `amount` step,
  positioned between « Précédent » and « Importer » in the button row.
  `disabled` when `!canSubmit` (all zones required — label is not
  required for preview so we could relax that, but keeping the same
  guard keeps the UI simple).
- New render block below the AmountStep controls, above the button row:
  a scrollable panel (`max-h-72 overflow-y-auto`) with a Date/Libellé/Montant
  table, styled identically to `ImportSummary` in
  `frontend/src/pages/Imports/PdfTemplateWizard.tsx` — same
  `text-ink-*`, `font-mono`, `amountSignClass`, `formatAmount`,
  `formatDate` helpers.
- Header: `Aperçu — N ligne(s) extraite(s)`. When
  `previewSkipped.length > 0`, a collapsible `<details>` with each
  skipped row's raw text + reason.
- Empty state (preview never clicked): a small greyed line
  « Cliquez sur *Aperçu* pour vérifier avant l'import. »
- Loading: inline spinner + « Aperçu en cours… ».
- Error: red-toned banner with the error message; no toast.

### Tests

**Backend** — `backend/src/http/routes/__tests__/imports-preview.spec.ts`
(new, gated by `RUN_DB_TESTS`):

1. Insert an account + a draft with a known PDF buffer (reuse an existing
   fixture PDF if the imports suite has one).
2. `POST /api/imports/pdf/templates/preview` with valid zones.
3. Assert 200, `rows.length > 0`, and that
   `SELECT count(*) FROM transactions WHERE user_id = uid` is unchanged.
4. Second test: expired draft → 410 with `code: 'draft_expired'`.
5. Third test: `draftId` from a different user → 410 (same behavior as
   missing; deliberate — don't leak existence).
6. Fourth test: preview with intentionally bad zones (e.g. debit column
   xEnd inside credit column) → 200 with `rows: []` and non-empty
   `skippedRows`.

**Frontend** — `frontend/src/components/PdfTemplateBuilder/__tests__/preview.test.tsx`
(new):

1. Mock `previewZones` to return 3 rows. Render builder at
   `step: 'amount'` with all zones painted. Click « Aperçu ». Assert
   the 3 rows render in the panel.
2. After preview renders, change `dateCol` (simulate re-paint). Assert
   the preview clears back to the empty state.
3. Mock `previewZones` to reject. Click « Aperçu ». Assert the error
   banner renders.

## Feature 2 — Full-text search across label + notes

### Backend

**Only change**: replace the single-column LIKE in
`backend/src/http/routes/transactions/index.ts` (~line 169-174) with an
OR across four fields:

```ts
if (q.search) {
  const needle = sql`immutable_unaccent(lower(${q.search}))`;
  where.push(sql`(
    immutable_unaccent(lower(${transactions.rawLabel})) LIKE '%' || ${needle} || '%'
    OR immutable_unaccent(lower(${transactions.normalizedLabel})) LIKE '%' || ${needle} || '%'
    OR immutable_unaccent(lower(coalesce(${transactions.memo}, ''))) LIKE '%' || ${needle} || '%'
    OR immutable_unaccent(lower(coalesce(${transactions.notes}, ''))) LIKE '%' || ${needle} || '%'
  )`);
}
```

Notes:

- `memo` and `notes` are nullable; `coalesce(..., '')` avoids a null
  short-circuit that would make the OR branch a no-op.
- `raw_label` and `normalized_label` are `NOT NULL`, so no coalesce.
- The needle is bound as a single parameter (Drizzle's `sql` template
  literals bind each `${…}` once); we reference it four times but
  Postgres receives one placeholder, four references.
- The `q.search` field is already `z.string().trim().max(128)` in
  `schemas.ts` — no injection risk beyond what LIKE already handles;
  wildcards `%` and `_` inside the needle stay as literals to match
  (they're substring markers, not regex).

**No migration.** `pg_trgm` is installed but not used here — v1 is a
seq-scan-friendly OR of ILIKE, which the homelab scale supports without
issues.

**Frontend**: no change. The Transactions page's `parseAmountQuery`
already routes numeric input to `q.amount` and text to `q.search`. The
sort=label option keeps sorting on `normalized_label` (unchanged) — it's
the most user-legible order regardless of which field matched.

### Tests

Extend the existing transactions integration suite
(`backend/src/http/routes/__tests__/transactions-list.spec.ts` or wherever
the search tests live — audit first, add if missing):

1. Insert 4 transactions for the same account:
   - `raw_label: 'CB PAYPAL EU', normalized_label: 'paypal eu', memo: null, notes: null`
   - `raw_label: 'AMZN MKTP', normalized_label: 'amzn mktp', memo: 'ID: NFX-42', notes: null`
   - `raw_label: 'VIR IBAN123', normalized_label: 'vir iban123', memo: null, notes: 'facture netflix'`
   - `raw_label: 'CB Grocery', normalized_label: 'cb grocery', memo: null, notes: null`
2. Assert `?search=paypal` → returns tx 1.
3. Assert `?search=NFX` (case-insensitive memo match) → returns tx 2.
4. Assert `?search=netflix` (notes match) → returns tx 3.
5. Assert `?search=grocery` → returns tx 4.
6. Assert `?search=xyz` → returns 0.
7. Assert accent-insensitivity: insert a tx with `notes: 'café'` and
   search for `cafe` → matches.

Skipping frontend tests here — the search box behavior isn't changing;
only what the backend matches on is.

## Rollout

Order doesn't matter — features are independent. Ship in two commits so
`git blame` stays readable:

1. `feat(pdf-wizard): preview endpoint + Aperçu button before import`
2. `feat(transactions): full-text search across labels + notes + memo`

Update `TODO.md`: move both items from « Pour plus tard » to « Fait ».

## Risks

- **Preview endpoint reads the full PDF buffer per click.** For a 10 MB
  PDF that's a base64-decode + `extractText` (pdfjs) on every Aperçu.
  On the homelab hardware that's ~1-2 seconds. If it feels sluggish, a
  future iteration can cache the parsed `pages` under the draft row.
- **Search OR-of-LIKE has no index.** On a 100k-row DB it becomes a
  seq scan on 400k text values. Not a problem at homelab scale, but
  the follow-up (generated column + GIN trigram) is documented in
  `TODO.md`'s « Recherche full-text » entry and remains straightforward.
- **`raw_label` and `normalized_label` are nearly duplicates.** Matching
  both is slight overkill, but the cost is one extra LIKE per row and
  the resilience against edge-case normalization (e.g. a Unicode
  character normalized away) is worth the noise.
