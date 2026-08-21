# Fuzzy import dedup — design

**Status:** approved, ready for implementation plan
**Date:** 2026-08-20

## Problem

Athena's dedup pipeline has two tiers today:

1. **Hard dedup at the DB level.** `transactions.dedup_key` is either the bank's `FITID` (when present in an OFX file) or `sha1(account|date|amount|normalized_label)`. A `UNIQUE(account_id, dedup_key)` constraint makes re-imports idempotent. Enforced by `computeDedupKey` in `backend/src/domain/imports/dedup.ts` and the `ON CONFLICT DO NOTHING` clause in `runImport` (`backend/src/domain/imports/import-service.ts:202`).
2. **Soft-dedup review panel.** `GET /api/transactions/duplicates` (`backend/src/http/routes/transactions/duplicates.ts`) surfaces groups of transactions that share **exact** `(account_id, date, amount)` but differ on `dedup_key`. Users dismiss false positives with "Ce n'est pas un doublon" (`POST /api/transactions/mark-not-duplicate`, flipping `not_duplicate=true`).

Three concrete blind spots:

- **Bank re-posts one day later.** Same purchase, `date` shifts by 1–2 days between the OFX and a corrective CSV. Hard dedup misses (different tuple) and the soft panel misses (exact-date-only match).
- **Rounding drift.** `-25.30` in one export vs `-25.31` in another (fee inclusion, currency conversion). Same misses.
- **Soft-panel noise.** Two genuinely unrelated transactions that happen to fall on the same date with the same amount surface as a "possible duplicate" group because the label is not consulted at all. The user clicks past them one at a time.

A tokenized label-similarity helper already exists (`backend/src/lib/label-similarity.ts`, kept in parity with `frontend/src/lib/label-similarity.ts` by a pinned fixture test) but is used only by the recurring-series detector, not by the dedup path.

## Non-goals

- **Cross-account transfer detection** (opposite-sign matching across accounts). The `transferRules` feature was previously dropped; `transfer_group_id` remains a legacy column that this spec does not resurrect. The fuzzy engine is designed so a later transfer spec can reuse it, but this spec ships pure duplicate detection only.
- **Fuzzy dedup for PDF imports.** The PDF pipeline has its own template-wizard preview flow; a future spec can wire fuzzy matching in once the parsing surface stabilizes.
- **Per-user tolerance settings.** Fixed constants ship first. Lifting them to `user_settings.settings` later is a small isolated follow-up.
- **Auto-skip without confirmation.** Every fuzzy suspect is user-visible in the preview modal; un-ticking the "skip" checkbox is required to force-import.
- **Retroactively re-evaluating already-imported rows.** Historic `not_duplicate=true` flags stay respected; the tighter soft-panel filter changes only what surfaces going forward.
- **pg_trgm / SQL-side label similarity.** PGlite (WASM) does not ship pg_trgm, and re-implementing Jaccard in SQL would break the pinned tokenizer parity with the frontend.

## Decisions

Locked during brainstorming, listed here so downstream planning can reference them:

| # | Decision |
|---|---|
| D1 | Match model: hard windows + label similarity gate. A pair fuzzy-matches iff `|Δdate| ≤ 3 days` **AND** `|Δamount| ≤ 0.02 €` **AND** `jaccardTokenSimilarity(labels) ≥ 0.5`. Boolean verdict, no confidence score in v1. |
| D2 | Same-sign only. Opposite-sign matching is transfer territory (out of scope). |
| D3 | Architecture: SQL narrows candidates by the cheap `(account_id, date, amount)` range, JS scores with existing `jaccardTokenSimilarity`. No new DDL, no new indexes, no PGlite extensions. |
| D4 | Preview UX: the preview modal gains a third row status `fuzzy-duplicate` with a pre-ticked "skip" checkbox. Users un-tick to force-import. Rows the user leaves ticked never reach `transactions`. |
| D5 | Soft-panel behavior: widen the tuple match to fuzzy windows, then filter groups in JS by max-pairwise Jaccard ≥ 0.5. The response shape and the `not_duplicate` flag semantics are unchanged. |
| D6 | Constants live in one place: `backend/src/domain/dedup/fuzzy-match.ts` exports `MAX_DAY_DELTA`, `MAX_AMOUNT_DELTA`, `LABEL_JACCARD_THRESHOLD`. No feature flag, no runtime knob. |
| D7 | One narrow DDL change: `file_imports.user_skipped integer NOT NULL DEFAULT 0` (migration `0039_…`) so the import summary can distinguish "skipped by the user in preview" from "skipped by hard dedup". No changes to `transactions`. `transfer_group_id IS NOT NULL` rows are excluded from fuzzy matching on both sides so a future transfer-pairing spec does not collide. |

## Architecture

New module `backend/src/domain/dedup/fuzzy-match.ts`. The location is deliberate: `dedup/` is a new sibling of `imports/` because two consumers (import preview and the soft-dedup panel) share it, and putting it under `imports/` would misrepresent its ownership.

```
backend/src/domain/
├── dedup/
│   ├── fuzzy-match.ts          # NEW — the shared engine
│   └── __tests__/
│       ├── fuzzy-match.test.ts             # unit, no DB
│       └── fuzzy-match.integration.test.ts # gated by RUN_DB_TESTS=1
├── imports/
│   ├── dedup.ts                # UNCHANGED — hard dedup key
│   ├── preview-service.ts      # CHANGED — emits fuzzyDuplicateRows
│   └── import-service.ts       # CHANGED — accepts skipParsedIndices
```

Consumers:

- `backend/src/domain/imports/preview-service.ts` (preview flow).
- `backend/src/http/routes/transactions/duplicates.ts` (soft panel).

`backend/src/lib/label-similarity.ts` is imported verbatim — the pinned parity test with `frontend/src/lib/label-similarity.ts` (see `backend/tests/label-similarity-parity.test.ts`) is protected by not editing either copy.

### Engine API

```ts
export const MAX_DAY_DELTA = 3;               // days
export const MAX_AMOUNT_DELTA = 0.02;         // euros, absolute
export const LABEL_JACCARD_THRESHOLD = 0.5;

export interface FuzzyCandidate {
  txId?: number;                              // undefined for incoming; present for existing
  date: string;                               // YYYY-MM-DD
  amount: string;                             // signed decimal, matches DB column type
  normalizedLabel: string;
  rawLabel: string;
}

// Pure predicate. Same-account is caller's responsibility.
export function fuzzyMatchesPair(a: FuzzyCandidate, b: FuzzyCandidate): boolean;

export interface ScoredMatch {
  candidate: FuzzyCandidate;   // existing row
  jaccard: number;             // in [LABEL_JACCARD_THRESHOLD, 1]
}

// Batch entry. Returns a map from `incoming[i]` to every existing candidate it
// matches, sorted by Jaccard descending (best first). Missing key means "no
// fuzzy match for that row". Callers that only need the top-N take a slice.
export async function findFuzzyMatches(opts: {
  accountId: number;
  userId: number;
  incoming: FuzzyCandidate[];
}): Promise<Map<number, ScoredMatch[]>>;
```

### Predicate rules (`fuzzyMatchesPair`)

Applied in this order (fail-fast is cheaper than Jaccard):

1. **Sign check.** `sameSign(a.amount, b.amount)` — reject opposite sign.
2. **Date window.** `|dateDiffDays(a.date, b.date)| ≤ MAX_DAY_DELTA`.
3. **Amount window.** `|parseDecimal(a.amount) - parseDecimal(b.amount)| ≤ MAX_AMOUNT_DELTA`.
4. **Label gate.** Both `normalizedLabel` non-empty (see edge case below) **AND** `jaccardTokenSimilarity(a.rawLabel, b.rawLabel) ≥ LABEL_JACCARD_THRESHOLD`.

Edge case — **empty labels reject.** `jaccardTokenSimilarity("", "") = 1` by design (it powers the recurring-series detector, where "no label" is a legitimate cluster key). For dedup we want the opposite: two rows without extractable label content give us zero signal, so they must not fuzzy-match on date+amount alone. `fuzzyMatchesPair` returns `false` if either side's normalized label produces zero tokens (checked via a helper mirroring the tokenizer in `label-similarity.ts`).

### Two-stage lookup (`findFuzzyMatches`)

Stage 1 — one SQL round-trip:

```sql
SELECT id, date, amount, normalized_label, raw_label
FROM transactions
WHERE user_id = $1
  AND account_id = $2
  AND date       BETWEEN $3 AND $4        -- [min(incoming.date) - 3, max(incoming.date) + 3]
  AND amount::numeric BETWEEN $5 AND $6   -- [min - 0.02, max + 0.02]
  AND transfer_group_id IS NULL
```

Uses the existing `(account_id, date)` index for the range scan; the amount predicate becomes a filter on the narrow candidate set. On a typical account (~1–5k rows/year, worst-case ~20k lifetime) this returns a handful of rows for a 200-row import.

Stage 2 — JS pass:

```ts
for (const existing of candidates) {
  for (let i = 0; i < incoming.length; i++) {
    if (!passesHardWindows(incoming[i], existing)) continue;
    const jaccard = jaccardTokenSimilarity(incoming[i].rawLabel, existing.rawLabel);
    if (jaccard < LABEL_JACCARD_THRESHOLD) continue;
    pushIntoMap(result, i, { candidate: existing, jaccard });
  }
}
// Sort each incoming row's matches by Jaccard descending before returning.
for (const list of result.values()) list.sort((a, b) => b.jaccard - a.jaccard);
```

`passesHardWindows` is the sign + date + amount gate factored out of `fuzzyMatchesPair` so the batch path can avoid tokenizing twice when only the score is needed. `fuzzyMatchesPair` keeps its own composition (`passesHardWindows` + `hasLabelSignal` + Jaccard) for the pure-predicate consumers.

Complexity O(|candidates| × |incoming|) with candidates already narrowed by the SQL windows; on the personal-scale dataset this is negligible compared to the file parse itself.

## Preview flow (import time)

### Backend

`backend/src/domain/imports/preview-service.ts` — new field and one call:

```ts
export interface FuzzyDuplicatePreviewRow {
  row: PreviewRow;
  parsedIndex: number;                        // stable index into parsed[]
  matches: Array<{
    txId: number;
    date: string;
    amount: string;
    rawLabel: string;
  }>;
}

export interface PreviewResult {
  filename: string;
  format: PreviewFormat;
  accountId: number;
  totalRows: number;
  newRows: PreviewRow[];                      // unchanged (hard-new)
  duplicateRows: PreviewRow[];                // unchanged (hard-dup by dedup_key)
  fuzzyDuplicateRows: FuzzyDuplicatePreviewRow[];   // NEW
}
```

Flow inside `previewImport`:

1. Parse the file.
2. Compute `dedupKey` for each parsed row (as today).
3. Fetch existing `dedup_key` set (as today) → partition into hard-dup and hard-new.
4. Call `findFuzzyMatches({ accountId, userId, incoming: hardNew })`.
5. Every hard-new row that has ≥ 1 fuzzy match moves into `fuzzyDuplicateRows`; the rest stays in `newRows`.
6. `matches` on each `FuzzyDuplicatePreviewRow` takes the top 3 entries from the engine's already-sorted `ScoredMatch[]` (Jaccard descending); the score itself is dropped from the wire response — v1 does not surface a confidence number to the user (D1).

`backend/src/http/routes/imports.ts` — `POST /api/imports` accepts an optional `skipParsedIndices: number[]` in the multipart form data (JSON-encoded string field alongside the file). The importer's `runImport` gains a matching parameter; before the `INSERT ... ON CONFLICT DO NOTHING`, rows whose parser-emitted index is in the skip set are dropped. Parsing is deterministic on the same file buffer, so indices sent from the preview stay valid at commit time.

Skip counts are surfaced in the import result as a new `userSkipped: number` field alongside `insertedCount` and `dedupSkipped`, and stored in `file_imports` (new nullable column `user_skipped`, defaulted to 0 — **the only DDL change in this spec**, see "Data model" below). This keeps the import summary honest ("N inserted, M hard-skipped, K user-skipped") for the audit trail on the Imports page.

### Frontend

`frontend/src/api/imports.ts`:

```ts
export interface ImportPreview {
  filename: string;
  format: string;
  accountId: number;
  totalRows: number;
  newRows: ImportPreviewRow[];
  duplicateRows: ImportPreviewRow[];
  fuzzyDuplicateRows: Array<{                  // NEW
    row: ImportPreviewRow;
    parsedIndex: number;
    matches: Array<{ txId: number; date: string; amount: string; rawLabel: string }>;
  }>;
}
```

`frontend/src/pages/Imports/ImportPreviewModal.tsx`:

- `Tagged` gains `'fuzzy-duplicate'` alongside `'new' | 'duplicate'`.
- A new checkbox column appears **only** on fuzzy rows (pre-ticked = "skip on commit").
- Each fuzzy row is expandable inline (chevron), showing the top match: `→ <existing date>  <existing raw label>  <existing amount>`. When `matches.length > 1`, a "+N more" hint appears.
- The header count line grows a third segment: `N nouvelles · M doublons · K doublons probables`.
- On confirm, the modal computes `skipParsedIndices` = `fuzzyDuplicateRows.filter(r => stillTicked(r)).map(r => r.parsedIndex)` and passes it up.

`frontend/src/pages/Imports/useImportPreview.ts` — the `confirm` call adds a `skipParsedIndices` field to the multipart body; the existing `apiUpload` helper accepts an extra form-field map (small extension; if the helper doesn't accept fields today, we add a `fields?: Record<string, string>` parameter as part of this work).

### i18n

Two new keys in `frontend/src/locales/{fr,en}/imports.json`:

- `previewModal.fuzzyCount` — `"K doublons probables"` / `"K probable duplicates"`.
- `previewModal.status.fuzzyDuplicate` — `"probable"` / `"probable"`.
- `previewModal.fuzzyMatchLabel` — `"correspond à"` / `"matches"`.

Kept in the same file as the existing `previewModal.*` keys for cohesion.

## Soft-dedup panel (post-import)

`backend/src/http/routes/transactions/duplicates.ts` — the `GET /api/transactions/duplicates` handler changes internally; the response shape is preserved.

### New SQL

Replace the exact `(account_id, date, amount)` tuple with a fuzzy join over the same table:

```sql
SELECT DISTINCT ON (t.id) t.*
FROM transactions t
JOIN transactions t2
  ON t2.user_id = t.user_id
 AND t2.account_id = t.account_id
 AND t2.id <> t.id
 AND ABS(t2.date - t.date) <= 3
 AND ABS(t2.amount::numeric - t.amount::numeric) <= 0.02
 AND SIGN(t2.amount::numeric) = SIGN(t.amount::numeric)
 AND t2.transfer_group_id IS NULL
WHERE t.user_id = $userId
  AND t.transfer_group_id IS NULL
  AND (t.account_id = $accountFilter OR $accountFilter IS NULL)
```

The candidate set is then post-filtered in JS by Jaccard.

### Grouping

Groups today are `(account_id, date, amount)`-keyed. Under fuzzy match, a natural key does not exist — a chain `a ↔ b ↔ c` where `a` and `c` do not directly fuzzy-match can still form one group. Two ways to define groups:

- **Connected components** across the fuzzy-adjacency graph → one group per component.
- **Nearest-representative clustering** → for each row, pick the earliest fuzzy-match neighbor by date; group rows that share a representative.

**Choice: connected components.** Simpler to explain to the user ("these rows are all mutually suspicious"), matches how the current UI presents groups (a set of rows the user judges together), and easier to implement (Union-Find on the candidate edges).

Filter after grouping: keep a group iff its `groupMinPairwiseSimilarity(rawLabels) ≥ LABEL_JACCARD_THRESHOLD` — the existing helper from `backend/src/lib/label-similarity.ts`. A group where the ONLY reason rows collided is date+amount coincidence with disjoint labels drops out (this is the main soft-panel noise reduction).

**Not-a-duplicate handling.** Same as today: `BOOL_OR(NOT not_duplicate)` is evaluated per group after clustering. A group where every member has `not_duplicate=true` is hidden. Marking one row in a group as not-a-duplicate does NOT dissolve the group — the other rows remain grouped with the flagged row present but styled as dismissed (mirrors today's behavior).

### Response shape (unchanged)

```ts
{ groups: Array<{ accountId: number; date: string; amount: string; transactions: Row[] }> }
```

For fuzzy groups, `date`/`amount` on the group envelope become the **earliest row's** values (deterministic tie-break by `id ASC`). They are display-only in the frontend today, so the semantics gently shift from "the shared tuple" to "the anchor row" without breaking clients.

## Data model

**One new column, one migration:**

```sql
-- migration 0039_file_imports_user_skipped.sql
ALTER TABLE file_imports
  ADD COLUMN user_skipped integer NOT NULL DEFAULT 0;
```

Drizzle: add `userSkipped: integer('user_skipped').notNull().default(0)` to `fileImports` in `backend/src/db/schema.ts`.

Zod backup schema: add `userSkipped: z.number().int().default(0)` to the `fileImports` block in `backend/src/http/routes/backup/schema.ts` (with `.default(0)` so old backups restore cleanly), and pass it through in `restore-transactions.ts`.

No changes to `transactions`. `computeDedupKey` untouched. `transfer_group_id` untouched (excluded from matching on both sides).

## Error handling

- **Fuzzy engine failure** during `previewImport`: caught in the route handler, logged, and the preview falls back to today's shape (`fuzzyDuplicateRows: []`). The user still gets a working preview with hard-dedup only. The Fastify error logger emits a `preview-fuzzy-failed` line with the file name for triage.
- **Fuzzy engine failure** during `runImport`: fuzzy matching does not run inside `runImport` — the skip list is already computed at preview time. Commit path is unchanged from today.
- **Skip list references invalid indices** (client bug or tampered payload): silently ignored. Indices outside `[0, parsed.length)` are filtered out; duplicate indices deduped by Set.
- **Empty label on incoming row**: never fuzzy-matches (see engine edge case). Falls through to hard-new.
- **Very large batch** (>1000 rows on a busy account): the range SQL is still bounded by the date/amount window, but the JS pass is O(candidates × incoming). Cap `matches` at 3 per row keeps payload bounded; no other guard needed on personal-scale data.

## Testing

### Unit — no DB required

`backend/src/domain/dedup/__tests__/fuzzy-match.test.ts`:

- `fuzzyMatchesPair` table-driven:
  - Δdate ∈ {0, 1, 3} → accept; Δdate = 4 → reject.
  - Δamount ∈ {0, 0.01, 0.02} → accept; Δamount = 0.03 → reject.
  - Sign: `-25.30` vs `+25.30` → reject.
  - Label boundary: `"CARREFOUR MARKET"` vs `"MARKET CARREFOUR"` → accept (Jaccard 1); `"CARREFOUR"` vs `"SNCF"` → reject (0).
  - Empty labels both sides → reject.
  - Realistic pair: raw labels `"CB CARREFOUR 12345 27/07"` vs `"PAIEMENT CB CARREFOUR REF-98"` post-normalization → accept.

### Integration — gated by `RUN_DB_TESTS=1`

`backend/src/domain/dedup/__tests__/fuzzy-match.integration.test.ts`:

- Seed ~50 rows across two accounts, run `findFuzzyMatches` with 5 incoming rows.
- Assert cross-account rows never surface.
- Assert `transfer_group_id IS NOT NULL` rows are excluded.
- Assert the amount/date range predicate excludes rows outside the window.

### Preview service — extend existing tests

`backend/src/domain/imports/__tests__/preview-service.test.ts`:

- File with one row identical to an existing dedupKey → `duplicateRows.length === 1`, `fuzzyDuplicateRows === []`.
- File with one row differing only by +1d and Jaccard ~0.7 → `fuzzyDuplicateRows.length === 1`, `matches[0].txId` populated.
- File with one row same date but Jaccard 0.0 → `newRows.length === 1` (no fuzzy match).

### Soft panel — extend existing tests

`backend/src/http/routes/transactions/__tests__/duplicates.test.ts` (if absent, add):

- Seed three rows same `(account, date, amount)` with disjoint labels → response `groups.length === 0`.
- Same test with Jaccard-similar labels → `groups.length === 1`.
- Two rows Δdate=2, Δamount=0.01, Jaccard 0.7 → `groups.length === 1`.
- Same but Jaccard 0.3 → `groups.length === 0`.

### Frontend

`frontend/src/pages/Imports/__tests__/ImportPreviewModal.test.tsx`:

- Renders three rows (`new` / `duplicate` / `fuzzy-duplicate`) → checkbox visible only on the fuzzy row, pre-ticked.
- Un-ticking then confirming → `onConfirm({ skipParsedIndices: [] })`.
- Leaving ticked → `onConfirm({ skipParsedIndices: [<parsedIndex>] })`.

### E2E (Playwright)

`e2e/imports-fuzzy-dedup.spec.ts`:

- Log in → seed an OFX with row `2026-07-01, -25.30, "CB CARREFOUR"` via preview + confirm.
- Upload a second OFX with row `2026-07-02, -25.31, "PAIEMENT CARREFOUR"`.
- Assert preview modal shows the second row with status "probable" and a pre-ticked skip box.
- Un-tick, confirm → assert both rows present in the transactions list.

### Parity — no change

`backend/tests/label-similarity-parity.test.ts` is not touched. The engine imports `jaccardTokenSimilarity` verbatim.

## Rollout

- No feature flag. Fuzzy dedup ships as an additive change to the existing preview + soft-panel contracts.
- One DB migration (`0039_file_imports_user_skipped.sql`) — `ADD COLUMN … DEFAULT 0`, safe to apply live.
- Rollback path: revert the changed files (`fuzzy-match.ts`, `preview-service.ts`, `import-service.ts`, `imports.ts` route, `duplicates.ts`, `ImportPreviewModal.tsx`, `useImportPreview.ts`, `imports.ts` API client) and revert the migration. Transaction data untouched throughout — a rollback loses the `user_skipped` count on `file_imports` rows imported during the fuzzy window but nothing else.
- The tighter soft panel will show **fewer** groups than before; this is the intended win, not a regression. Users who prefer the old behavior have no toggle in v1 (per D6); the follow-up per-user tolerance spec can add one.

## Deferred to follow-up

- Cross-account transfer detection (opposite-sign fuzzy pairing) — reuses this engine's date/amount windows.
- Per-user tolerance settings — lift constants into `user_settings.settings`.
- Fuzzy dedup for the PDF import flow.
- Confidence scoring / weighted Jaccard — v1 is a boolean gate; a "how sure are we" score can shape a future UX.
