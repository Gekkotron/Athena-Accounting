# Statement Reconciliation — Design

**Date:** 2026-07-09
**Status:** Approved (design), pending implementation plan

## Goal

Automate the manual, multi-hour job of checking a bank-statement PDF against
what is already recorded in Athena. Expose a **read-only** MCP tool,
`reconcile_statement`, that parses a statement PDF (reusing the account's saved
import template) and returns a deterministic four-bucket report — **matched /
missing / mismatched / extra** — so a local LLM (Ollama in LM Studio) can run
the check conversationally and read the result back. Nothing is written;
adding the missing transactions is done by re-running Athena's normal PDF
import (its dedup inserts exactly the missing ones).

## Constraints & context

- **The LLM must never decide matches.** Reconciling money by letting a model
  judge whether two lines are "the same" is unsafe — and the light local model
  in use has already proven it will misread even a correct tool result (it
  received a populated `search_transactions` result and reported "none found").
  Therefore ALL parsing and matching is deterministic backend code; the model
  only triggers the tool and relays a backend-rendered sentence.
- **Reuse, don't reinvent.** Athena already parses this bank's PDF via a saved
  template and already computes a `dedupKey` per transaction
  (`computeDedupKey` in `backend/src/domain/imports/dedup.ts`). That key is the
  deterministic match primitive. The reconcile parser is refactored out of the
  existing `importPdf` so import and reconcile share one code path.
- **A saved PDF template already exists** for the target statements (confirmed
  with the user). If a statement has no matching template, reconcile returns a
  clear `needs_template` result rather than guessing.
- **Single-endpoint security preserved.** Reconcile flows through the existing
  encrypted `/api/mcp/rpc` tunnel and in-process `app.inject`, not a new public
  route.
- **Public-safe.** No real hosts/tokens/secrets in code, tests, or docs.

## Data flow

```
LM Studio (model) → reconcile_statement(path, accountId, fromDate?, toDate?)
   │
MCP server (Mac): read PDF at `path`, validate (.pdf, ≤10MB, exists),
   base64-encode → client.rpc('reconcile_statement', { pdfBase64, accountId, fromDate?, toDate? })
   │ encrypted tunnel
POST /api/mcp/rpc → app.inject → POST /api/reconcile   (internal, behind requireAuth)
   • decode PDF → parse-only via saved template → ParsedTransaction[]
   • compute dedupKey per line; fetch Athena tx for account (+ statement date span)
   • reconcile() → { summary, summaryText, matched, missing, mismatched, extra }
   │ encrypted report back
MCP server → returns report (summaryText first) → model relays it
```

## Components

### A. Parse-only PDF function (backend)

File: `backend/src/domain/imports/pdf/` (refactor within the existing module).

- Extract the reusable "PDF buffer → `ParsedTransaction[]` via the saved
  template" logic out of `importPdf` into a `parsePdfWithTemplate(opts: {
  buffer: Buffer; accountId: number; userId: number }): Promise<
  { kind: 'parsed'; rows: ParsedTransaction[] } | { kind: 'needs_template' }>`.
  It performs text extraction + template application only — **no insert**,
  no `file_imports` row, no rule engine, no transfer detection.
- `importPdf` is refactored to call `parsePdfWithTemplate` and then insert, so
  the two paths cannot drift. Existing import behaviour is unchanged (covered
  by a regression test).
- Password-protected / encrypted PDFs surface the existing `pdf_encrypted`
  error; no-template surfaces `needs_template`.

### B. Reconcile domain (backend)

File: `backend/src/domain/reconcile/reconcile.ts`.

Pure, deterministic, DB-free function:

```
reconcile(
  statement: ParsedTransaction[],
  existing: ExistingTx[],           // {id, date, amount, rawLabel, normalizedLabel, dedupKey}
  opts: { accountId: number; dateToleranceDays?: number /* default 3 */ }
): ReconcileReport
```

Matching rules (in order, each statement line consumes at most one Athena row;
each Athena row is matched at most once):
1. **matched** — statement line whose `dedupKey` equals an existing row's
   `dedupKey` (exact: same account/date/amount/normalized-label).
2. **mismatched** — not an exact dedup match, but a candidate exists:
   - `date_off`: an existing row with the **same amount and same normalized
     label**, dated within ±`dateToleranceDays` of the statement line (posted a
     few days off), or
   - `amount_differs`: an existing row with the **same normalized label and a
     date within ±`dateToleranceDays`** but a **different amount**.
   Reported with both sides and the `reason`. Label comparison is exact
   equality on `normalizeLabel(...)` output (accent/case-insensitive), not a
   fuzzy score — keeps matching deterministic.
3. **missing** — statement line with neither an exact nor a mismatch candidate.
4. **extra** — existing rows for that account, within `[minStatementDate,
   maxStatementDate]`, that no statement line matched, **excluding transfer
   legs** (`transferGroupId` is not null).

`dateToleranceDays` default 3. Statement period is derived from the parsed
lines' min/max date unless `fromDate`/`toDate` override the "extra" window.

Report shape:
```
{
  account: { id, name },
  statementPeriod: { from, to },
  summary: { statementLines, matched, missing, mismatched, extra },
  summaryText: string,          // backend-rendered, human-readable (see below)
  missing:    [{ date, amount, rawLabel }],
  mismatched: [{ statement: {date,amount,label}, athena: {id,date,amount,label}, reason }],
  extra:      [{ id, date, amount, rawLabel }]
}
```

`summaryText` is built server-side, e.g.:
> `April 2025 · account "Courant" — 42 lines: 40 matched, 2 missing, 1 mismatch, 0 extra.`
> `Missing: 2025-04-12 −18.90 FNAC; 2025-04-27 −7.50 BOULANGERIE.`
> `Mismatch: 2025-04-05 PRIME — statement −54.00 vs Athena −45.00.`

The model relays `summaryText`; it does not compute or interpret the buckets.

### C. Route `POST /api/reconcile` (backend)

- Registered behind `requireAuth` (so `app.inject` from the tunnel reaches it,
  authenticated as the resolved user).
- Body: `{ pdfBase64: string, accountId: number, fromDate?: string, toDate?: string }`.
- Steps: validate account ownership → decode base64 (reject > `PDF_MAX_BYTES`,
  10 MB) → `parsePdfWithTemplate` → on `needs_template` return 422
  `{ code: 'needs_template' }` → fetch existing account transactions in the
  window → `reconcile()` → 200 report.
- Errors: unknown/again-not-owned account → 400; `pdf_encrypted` → 400;
  oversize → 413.

### D. Op registry + MCP tool

- `backend/src/http/routes/mcp/ops.ts`: add `reconcile_statement` →
  `{ method: 'POST', url: '/api/reconcile', payload: args }`. Read-only (no
  mutation), consistent with the read-tool posture.
- `mcp/src/tools.ts`: new tool `reconcile_statement` with args
  `{ path: string; accountId: number; fromDate?: string; toDate?: string }`.
  Handler (MCP server, on the Mac): `node:fs` reads `path`, validates it exists,
  ends in `.pdf`, and is ≤10 MB; base64-encodes; calls
  `client.rpc('reconcile_statement', { pdfBase64, accountId, fromDate, toDate })`.
  Returns the report with `summaryText` first in the text content so the model
  leads with it. Clear tool errors for missing file / not-a-pdf / oversize.
- This is the first MCP tool that reads the local filesystem; validation lives
  MCP-side. The read is of a user-named path under the user's own account — no
  traversal concern, but non-`.pdf`/oversize/missing are rejected with messages.

### E. `search_transactions` summary (small, folded in)

To stop light models from garbling raw results, the `search_transactions` MCP
tool prepends a one-line human summary to its text content, e.g.
`12 transactions, 2025-04-01–2025-04-30, total −312.40 €.` The full structured
JSON still follows. This is an MCP-side formatting change only; the backend
route is untouched.

## Applying the missing transactions

`reconcile_statement` is read-only. When the report shows N missing, the user
imports the same PDF through Athena's normal import; dedup inserts exactly the
missing rows and skips the rest. `summaryText` states this explicitly when
`missing > 0`. No new write path is added.

## Error handling summary

- No template for the PDF → 422 `needs_template` → friendly tool message
  ("import this statement once in Athena to set/retrain its template").
- Missing path / not a `.pdf` / > 10 MB → MCP-side error before any request.
- Password-protected PDF → mapped from `pdf_encrypted`.
- Unknown / not-owned account → 400.

## Testing

- **Backend unit (ungated, no DB):** `reconcile()` truth table — exact match;
  missing; amount-differs mismatch; date within ±3 days (matched-as-mismatch)
  vs outside (missing); extra; transfer legs excluded from extra; empty
  statement; multiple lines competing for one Athena row (each matched once).
  Plus `summaryText` rendering for a representative report.
- **Backend regression:** `parsePdfWithTemplate` yields the same rows the
  importer produces for an existing PDF fixture (reuse a fixture from the PDF
  import tests), proving the refactor is behaviour-preserving.
- **Backend DB-gated (`RUN_DB_TESTS`, CI):** `POST /api/reconcile` end-to-end —
  a fixture PDF + seeded transactions → asserts the four buckets and the 422
  `needs_template` path.
- **MCP (pure unit):** `reconcile_statement` arg→request mapping (reads file →
  base64 → op + args) with mocked `fs`/client; error cases (missing file,
  non-pdf, oversize). `search_transactions` summary-line formatting.

## Out of scope (YAGNI)

- Auto-inserting the missing transactions (use the existing import).
- Multi-account reconciliation from a single PDF (one account per call).
- OFX/CSV reconciliation (structured, easier — can follow later).
- Fuzzy label matching beyond the mismatch heuristic; configurable tolerance UI.
- A frontend "Reconcile" screen (the deterministic core would make one easy
  later, but it is not part of this spec).
