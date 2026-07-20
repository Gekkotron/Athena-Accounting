# Large-file refactor (pilot) — design

**Date:** 2026-07-20
**Status:** approved, ready for plan
**Scope:** split 3 source files that exceed 400 lines into cohesive per-concern
modules following the repo's existing `routes/<resource>/{index,schemas,helpers,…}.ts`
convention, and add focused unit tests for the pure logic extracted along the
way. This is a **pilot pass** — 11 more source files sit above 400 lines and
will be handled in follow-up sessions once this pattern is validated.

## Problem

A repo audit turned up 14 non-generated source files above 400 lines:

| Lines | File |
|---|---|
| 627 | `backend/src/http/routes/reports.ts` |
| 585 | `backend/src/db/schema.ts` *(excluded — Drizzle table declarations, no runtime risk from staying big)* |
| 572 | `frontend/src/pages/Rules/Categories.tsx` |
| 551 | `frontend/src/components/PdfTemplateBuilder/index.tsx` |
| 542 | `frontend/src/components/BalanceChart/index.tsx` |
| 519 | `frontend/src/pages/Transactions/index.tsx` |
| 509 | `backend/src/http/routes/envelopes.ts` |
| 507 | `frontend/src/api/demo/handlers/reads.ts` |
| 487 | `backend/src/http/routes/accounts.ts` |
| 477 | `backend/src/http/routes/transactions/index.ts` |
| 467 | `backend/src/domain/imports/pdf/index.ts` |
| 460 | `frontend/src/api/demo/handlers/writes.ts` |
| 458 | `frontend/src/pages/Recurrent/ForecastTab.tsx` |
| 456 | `frontend/src/pages/Transactions/TransactionModal.tsx` |

Large single-file modules concentrate too many concerns: schemas, pure helpers,
SQL fragments, and multiple handler bodies all coexist in `reports.ts`. This
makes edits noisier, review harder, and — critically for a repo about to go
public — increases the cognitive load on new readers browsing the source.

The project has a strong existing pattern for splitting: `backup/` and
`transactions/` route directories already contain `index.ts`, `schemas.ts`,
`helpers.ts`, and per-concern handler files. This spec applies that pattern to
three of the largest offenders as a pilot.

## Non-goals

- Not touching `backend/src/db/schema.ts`. Drizzle table declarations are a
  single flat namespace; splitting them would fragment an intentionally
  cohesive file with no reader benefit.
- Not touching the other 11 files this pass. Listed in "Follow-up" for a
  future session or `PLAN.md` backlog.
- Not splitting large test files (`transactions-route.test.ts` 842,
  `imports-route.test.ts` 545, etc.). Test-file size is a separate concern
  with different trade-offs (locality of setup, one-file-per-suite ergonomics).
- Not adding "full unit coverage" for every extracted module. Handler
  wrappers stay covered by existing integration tests; new unit tests target
  extracted **pure logic only**.

## The three splits

Each split follows the same rule: promote each existing top-level construct
(schema group, pure helper set, serializer group, route handler) into its own
file, keeping the composer (`index.ts`) as the only thing that touches
`FastifyInstance` / React tree wiring.

### Split 1 — `backend/src/http/routes/reports.ts` (627 lines)

Target directory: `backend/src/http/routes/reports/`

| File | Content | Est. LoC |
|---|---|---|
| `index.ts` | `reportsRoutes(app)` — wires the 4 handlers under `preHandler: requireAuth` | ~40 |
| `schemas.ts` | `RangeQuery`, `BudgetQuery` (Zod) | ~25 |
| `sql-fragments.ts` | `TX_EFFECTIVE_CTE` (shared Drizzle `sql` fragment) | ~20 |
| `period-math.ts` | `elapsedIn`, `computeProjected`, `priorPeriodKeys`, `mean`, `median`, `stdev`, plus `annotateBudgetRow` extracted from the `/budget` handler body | ~160 |
| `balance.ts` | `GET /api/reports/balance` handler | ~70 |
| `timeseries.ts` | `GET /api/reports/timeseries` handler | ~65 |
| `categories.ts` | `GET /api/reports/categories` handler | ~50 |
| `budget.ts` | `GET /api/reports/budget` handler (now delegates row annotation to `annotateBudgetRow`) | ~250 |

`budget.ts` stays the largest post-split at ~250 lines. It is one atomic
transaction (fetch → fetch history → fetch candidates → assemble); further
subdivision would fragment cohesion. Extracting `annotateBudgetRow` — the
pure per-row `history / anomaly / suggestedLimit` computation, ~80 lines —
lifts the testable logic out.

**New unit test:** `backend/tests/reports-period-math.test.ts`
- `elapsedIn`: strictly-past period, strictly-future period, current-period (day 1, mid, last-day), boundary at `today == start` and `today == endExclusive`.
- `computeProjected`: past period (locked to `spent`), `elapsedDays < 3` returns `null`, linear extrapolation with fractional spend.
- `priorPeriodKeys`: monthly with Jan wrap (six prior months from Feb → prior Aug–Jan), yearly, key format assertions.
- `mean`/`median`/`stdev`: empty array, single element, even and odd lengths, all-equal (stdev == 0).
- `annotateBudgetRow`: no-history case (returns `history: null`, `anomaly: false`, `suggestedLimit: null`), qualifying history (≥ 2 non-zero), anomaly gating on `nonZeroCount >= 3`, suggestion gating on `overCount >= 3 || underHalfCount >= 3`, medianValue → tidy round-to-10% math.

Existing `backend/tests/reports-route.test.ts` (403 lines) unchanged — still exercises full handlers via HTTP.

### Split 2 — `frontend/src/pages/Rules/Categories.tsx` (572 lines)

Target directory: `frontend/src/pages/Rules/`

| File | Content | Est. LoC |
|---|---|---|
| `Categories.tsx` | Main page: data hooks, form, DnD wiring, table composition | ~250 |
| `CategoryTableRow.tsx` | `CategoryTableRow` subcomponent | ~190 |
| `DragGhost.tsx` | `DragGhost` subcomponent | ~25 |
| `categoriesTotals.ts` | Pure helpers: `buildOwnTotalsByCat(report: CategoryReportRow[])`, `rolledUpTotal(cat, ownTotals, childrenByParent)` | ~30 |

The `UpdateMutation` type (currently declared between the main component and
`CategoryTableRow`) moves into `CategoryTableRow.tsx` next to its consumer.

**New unit test:** `frontend/src/pages/Rules/__tests__/categoriesTotals.test.ts`
- `buildOwnTotalsByCat`: skips `category_id == null` rows, sums duplicates per category, coerces string amounts via `Number(...)`.
- `rolledUpTotal`: leaf (no children), parent-only (children map returns undefined), parent-with-children (rolls up all direct children), missing entry (returns 0).

Existing `frontend/src/pages/Rules/__tests__/Categories.test.tsx` (494 lines) unchanged.

### Split 3 — `backend/src/http/routes/envelopes.ts` (509 lines)

Target directory: `backend/src/http/routes/envelopes/`

| File | Content | Est. LoC |
|---|---|---|
| `index.ts` | `envelopesRoutes(app)` composer | ~45 |
| `schemas.ts` | `signedDecimal`, `monthStr`, `currency`, `IdParam`, `parseId(req, reply)` | ~30 |
| `helpers.ts` | `expenseCategoryOwned(uid, categoryId)` | ~15 |
| `serializers.ts` | `serializeAssignment`, `serializeSettings`, `serializeHold` | ~35 |
| `assignments.ts` | GET `/assignments`, PUT `/assignments`, DELETE `/assignments/:id` | ~75 |
| `reallocate.ts` | POST `/reallocate` (with `bumpBy` transaction closure) | ~75 |
| `settings.ts` | GET/PUT/DELETE `/categories(*/categoryId)` | ~90 |
| `holds.ts` | GET `/holds`, PUT `/holds` (zero-amount = delete branch) | ~55 |
| `report.ts` | GET `/report` (the 170-line one) | ~170 |

**New unit test:** `backend/tests/envelopes-serializers.test.ts`
- `serializeAssignment`: given a DB row shape (with `month` as first-of-month DATE string), returns `month` as `"YYYY-MM"` (guards the `month.slice(0, 7)` conversion — this is the subtle boundary that would silently corrupt the wire format if someone swapped it for `slice(0, 10)`).
- `serializeSettings`: passes through target/policy fields, no month math.
- `serializeHold`: same DATE-to-YYYY-MM guard as `serializeAssignment`.

Existing `backend/tests/envelopes-route.test.ts` (386 lines), `backend/tests/envelope-math.test.ts` (521 lines), and `backend/tests/envelope-schema.test.ts` unchanged.

## Cross-cutting concerns

**Test framework.** Vitest, already configured on both workspaces. No new
dependencies. Run with `npm --prefix backend test` and
`npm --prefix frontend test`.

**Verification gate.** Each commit must be self-contained:
1. Split code + new unit tests
2. `npm --prefix <workspace> test` fully green (not just the new file — the whole suite)
3. `npm --prefix <workspace> run build` succeeds
   - Backend: `tsc -p tsconfig.json && node scripts/copy-migrations.mjs`
   - Frontend: `tsc -b && vite build`
4. Only then commit

If any suite breaks, fix in the same commit — no "green in a follow-up".

**Commits.** One commit per file split. Direct to `main` per project convention
([[feedback_work_on_main_no_branches]]). Suggested messages:

```
refactor(reports): split reports.ts into per-handler modules + unit test period math
refactor(categories): split Categories.tsx into subcomponents + unit test totals
refactor(envelopes): split envelopes.ts into per-endpoint modules + unit test serializers
```

**Import paths.** `.js` extension on relative imports throughout (existing
project convention for the ESM+NodeNext backend). Frontend imports use no
extension.

**No re-exports.** The old `routes/reports.ts` / `routes/envelopes.ts` files
are deleted, not turned into barrel re-exports. Since the backend uses
NodeNext resolution with explicit `.js` extensions, `buildServer.ts`
currently imports `./http/routes/reports.js` and `./http/routes/envelopes.js`
(single-file form). Both import lines must be updated to
`./http/routes/reports/index.js` and `./http/routes/envelopes/index.js`
respectively — matching how `transactions` and `backup` are already
imported. Frontend `Categories.tsx` remains at the same path
(`pages/Rules/Categories`), so no router-config change is needed there.

## Failure modes considered

- **Circular imports.** `period-math.ts` is pure, imports nothing from
  siblings. Each handler file imports only from `schemas`, `sql-fragments`,
  `period-math`, and `db/client` — no cycles possible by construction.
- **Test locality lost.** Unit tests for pure logic go into `backend/tests/`
  (matching existing structure — every backend test lives there, not
  co-located). Frontend unit tests go into `__tests__/` neighbors, matching
  existing frontend convention.
- **`annotateBudgetRow` extraction subtly changes behavior.** Mitigated by
  the existing `reports-route.test.ts` (403 lines) which exercises the full
  `/budget` handler end-to-end. Any subtle drift would show up there before
  commit.
- **Frontend split changes rendering.** `CategoryTableRow` and `DragGhost`
  are pure presentational components — extracting them cannot change render
  output. The existing `Categories.test.tsx` (494 lines) catches any regression.

## Follow-up (out of scope this pass)

The remaining 11 files >400 lines, in descending size — deferred to a
follow-up session or fed to `PLAN.md` as backlog tasks after this pilot
validates the pattern:

- `frontend/src/components/PdfTemplateBuilder/index.tsx` (551)
- `frontend/src/components/BalanceChart/index.tsx` (542)
- `frontend/src/pages/Transactions/index.tsx` (519)
- `frontend/src/api/demo/handlers/reads.ts` (507)
- `backend/src/http/routes/accounts.ts` (487)
- `backend/src/http/routes/transactions/index.ts` (477)
- `backend/src/domain/imports/pdf/index.ts` (467)
- `frontend/src/api/demo/handlers/writes.ts` (460)
- `frontend/src/pages/Recurrent/ForecastTab.tsx` (458)
- `frontend/src/pages/Transactions/TransactionModal.tsx` (456)
- (`backend/src/db/schema.ts` — explicitly excluded, not deferred)
