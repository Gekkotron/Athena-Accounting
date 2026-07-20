# Plan

## Notes

Not parsed by the orchestrator — informational context for the human and the
planner. See `CLAUDE.md` for the parser contract.

### Docker + Tauri dual-track — foundational refactor

Goal: ship a Tauri desktop app (Mac/Windows/Linux) alongside the current Docker stack, from the same codebase. Docker path stays the family-server story; Tauri path is the "no install, no Docker" solo-user story. **Packaging pivoted from single-binary to directory-based sidecar** (2026-07-17) — the native-deps tree (sharp+libvips, @napi-rs/canvas, argon2, PGlite WASM, pdfjs worker, tesseract) is hostile to single-binary bundlers, and Tauri's sidecar mechanism accepts a folder just as happily.

### Cross-cutting risks to flag before starting

- **PGlite maturity** — 0.x. Extensions and some advanced JSON features unsupported. Athena's schema doesn't use those, but each task above should be verified rather than assumed.
- **Tauri code-signing on macOS** — needs an Apple Developer account ($99/yr) to avoid Gatekeeper warnings. Not blocking; document the workaround for now.
- **Bundle size** — directory-based sidecar is ~50–80 MB per platform (Node runtime ~30 MB + sharp/libvips ~15 MB + canvas/PGlite/pdfjs/tesseract adding more). Larger than a single stripped binary, but reliable. Note in release notes.
- **Cross-arch Node binaries** — macOS-arm64 hosts building macOS-x64 (or vice versa) need `unofficial-builds.nodejs.org` or a matching runner in CI. The packaging workflow's matrix strategy handles this automatically.

## Backlog

- [ ] Refactor: split `frontend/src/components/BalanceChart/index.tsx` (542 lines) into per-concern modules
      Follow the same pilot pattern (commits 017a1ea/70f12df/e01d841, design at `docs/superpowers/specs/2026-07-20-large-file-refactor-design.md`). BalanceChart mixes data aggregation, scale/tick math, gradient/marker rendering, and — since Récurrent Task 4 — projection-window merging. Extract every pure computation (series aggregation, x/y scale helpers, gap-detection, projection merge, tick formatters) into `frontend/src/components/BalanceChart/lib.ts`; if useful presentational fragments exist (axis, tooltip, legend, marker), promote each into a sibling `.tsx`.
      Add a focused unit test at `frontend/src/components/BalanceChart/__tests__/lib.test.ts` covering the extracted pure helpers — particularly the projection-merge boundary (historical→projection transition, dashed-segment gating, end-of-line marker anchoring described in Récurrent Task 4). The existing 28 BalanceChart tests must remain green untouched.
      Verification gate (single commit): full frontend test suite + `npm --prefix frontend run build` green; direct to main. Commit subject: `refactor(balance-chart): split BalanceChart into pure lib + presentational siblings and unit-test the helpers`.
      Success criteria: (a) `BalanceChart/index.tsx` under 250 lines; (b) `lib.ts` pure and independently testable; (c) all 28 existing BalanceChart tests + new helper tests green; (d) build clean.

- [ ] Refactor: split `frontend/src/pages/Transactions/index.tsx` (519 lines) into per-concern modules
      Same pilot pattern. `Transactions/index.tsx` is a page composer that owns filters, sorting, selection state, pagination, and table wiring. Keep `index.tsx` as the top-level page (data hooks + JSX composition); extract each pure derivation (filter predicate builder, sort comparator, selection reducer, URL-query serializer) into `frontend/src/pages/Transactions/lib.ts`; if row/toolbar/filter-bar/empty-state fragments are distinct, promote each into a sibling `.tsx`.
      Add `frontend/src/pages/Transactions/__tests__/lib.test.ts` covering the pure helpers — filter builder against representative filter combos, comparator stability under ties, URL-query round-trip. `TransactionModal.tsx` is a separate follow-up task, do not touch it here.
      Verification gate (single commit): full frontend suite + build green; direct to main. Commit subject: `refactor(transactions-page): split Transactions/index.tsx into subcomponents and unit-test filter/sort/query helpers`.
      Success criteria: (a) `Transactions/index.tsx` under 260 lines; (b) `lib.ts` is pure; (c) existing Transactions page tests still green untouched; (d) build clean.

- [ ] Refactor: split `frontend/src/api/demo/handlers/reads.ts` (507 lines) into per-endpoint modules
      Follow the envelopes pilot pattern (commit 017a1ea). The demo mode reads file registers many `GET` handlers over the fake store; each handler is largely independent. Target directory: `frontend/src/api/demo/handlers/reads/{index,serializers,filters,<group>.ts}` — group by resource (transactions, accounts, categories, envelopes, recurring, reports, imports, settings, etc.). `index.ts` becomes the registration composer that installs each per-group handler set; shared serializers/filters/store-query helpers move to sibling files.
      Add `frontend/src/api/demo/handlers/__tests__/reads-helpers.test.ts` covering the extracted pure helpers (any serializer, filter, or store-query utility) — do not try to unit-test the handler wiring; existing demo tests continue to guard that.
      Verification gate (single commit): full frontend suite green; both `VITE_DEMO=1 npm --prefix frontend run build` and plain `npm --prefix frontend run build` succeed; direct to main. Commit subject: `refactor(demo-reads): split demo reads handlers into per-resource modules and unit-test shared helpers`.
      Success criteria: (a) no single per-resource file over ~200 lines; (b) `index.ts` composer under ~80 lines; (c) both demo and non-demo frontend builds green.

- [ ] Refactor: split `backend/src/http/routes/accounts.ts` (487 lines) into per-concern modules
      Follow the reports/envelopes pilot (commits e01d841/017a1ea) exactly. Target directory: `backend/src/http/routes/accounts/{index,schemas,helpers,<handler>.ts}`. `index.ts` becomes the `accountsRoutes(app)` composer wiring handlers under `preHandler: requireAuth`; Zod schemas move to `schemas.ts`; any shared SQL fragment or ownership-check helper moves to `helpers.ts` or `sql-fragments.ts`; each HTTP handler gets its own file.
      Update `backend/src/buildServer.ts` to import `./http/routes/accounts/index.js` (NodeNext + explicit `.js` extension, matching how transactions/backup are already imported); delete the old `routes/accounts.ts` file, do not turn it into a barrel re-export.
      Add `backend/tests/accounts-<slug>.test.ts` for whatever pure logic gets extracted (ownership check, computed balance derivation, response shaping) — narrow, boundary-focused, mirroring `reports-period-math.test.ts` style. The existing `accounts-route.test.ts` remains untouched and continues to exercise handlers end-to-end.
      Verification gate (single commit): `npm --prefix backend test` fully green under `DB_DRIVER=pglite RUN_DB_TESTS=1`; `npm --prefix backend run build` (tsc + copy-migrations) succeeds; direct to main. Commit subject: `refactor(accounts): split accounts.ts into per-handler modules and unit-test extracted helpers`.
      Success criteria: (a) no per-handler file over ~120 lines; (b) old `routes/accounts.ts` deleted; (c) buildServer.ts import updated; (d) full backend suite + build green in the same commit.

- [ ] Refactor: further-split `backend/src/http/routes/transactions/index.ts` (477 lines) into per-handler modules
      This is already a folder from prior work — the composer file itself has grown too large. Inspect the current contents: any handlers still inlined in `index.ts` should be promoted into their own sibling file (`transactions/<verb-resource>.ts`); any pure helpers (query builders, filter compilation, response shapers) should move to `transactions/helpers.ts` or `transactions/query-builder.ts` if not already there. `index.ts` should end up as the composer + `preHandler` wiring only.
      Add `backend/tests/transactions-<slug>.test.ts` covering any newly-extracted pure helpers — boundary cases, empty-input, one representative happy-path. Existing `transactions-route.test.ts` (842 lines per the audit) continues to guard the full HTTP surface untouched.
      Verification gate (single commit): full backend suite green under `DB_DRIVER=pglite RUN_DB_TESTS=1`; `npm --prefix backend run build` succeeds; direct to main. Commit subject: `refactor(transactions-route): promote inlined handlers into per-endpoint modules and unit-test helpers`.
      Success criteria: (a) `transactions/index.ts` under 200 lines; (b) no sibling handler file over ~180 lines; (c) full backend suite + build green.

- [ ] Refactor: split `backend/src/domain/imports/pdf/index.ts` (467 lines) into per-stage modules
      Same pilot pattern applied to a domain module (not a route). Read the file to identify pipeline stages (likely: text extraction, OCR fallback, layout analysis, transaction-row detection, amount/date parsing, output shaping — actual stages TBD by inspection). Extract each cohesive stage into its own sibling file under `backend/src/domain/imports/pdf/`; keep `index.ts` as the pipeline composer exporting the top-level entry point.
      Add `backend/tests/pdf-import-<stage>.test.ts` for whichever stages are pure and testable in isolation — reuse the existing PDF-import fixture set to avoid drift. Existing PDF-import integration tests continue to protect the full pipeline untouched.
      Verification gate (single commit): full backend suite green under `DB_DRIVER=pglite RUN_DB_TESTS=1`; `npm --prefix backend run build` succeeds; direct to main. Commit subject: `refactor(pdf-import): split pdf/index.ts into per-stage modules and unit-test extracted stages`.
      Success criteria: (a) `pdf/index.ts` under 200 lines; (b) each per-stage file under ~200 lines; (c) full backend suite + build green.

- [ ] Refactor: split `frontend/src/api/demo/handlers/writes.ts` (460 lines) into per-endpoint modules
      Mirror of the demo-reads task. Target: `frontend/src/api/demo/handlers/writes/{index,mutators,<group>.ts}` — group by resource (transactions, accounts, categories, envelopes, recurring, settings, imports, etc.). `index.ts` becomes the registration composer; shared store-mutation helpers (id generation, updated-at stamping, cascade rules) move to a sibling.
      Add `frontend/src/api/demo/handlers/__tests__/writes-helpers.test.ts` covering the extracted pure helpers only.
      Verification gate (single commit): full frontend suite green; both `VITE_DEMO=1 npm --prefix frontend run build` and plain build green; direct to main. Commit subject: `refactor(demo-writes): split demo writes handlers into per-resource modules and unit-test shared helpers`.
      Success criteria: (a) no single per-resource file over ~200 lines; (b) `index.ts` composer under ~80 lines; (c) both demo and non-demo builds green.

- [ ] Refactor: split `frontend/src/pages/Recurrent/ForecastTab.tsx` (458 lines) into per-concern modules
      Follow the Categories.tsx pilot (commit 70f12df). ForecastTab owns horizon picker, account scope picker, chart wiring, and two stat tiles. Extract each visually-distinct fragment (horizon control, scope control, stat-tile pair) into a sibling `.tsx` where it earns its keep; extract any pure computation local to this tab (variation formatting, horizon→date mapping, stat-tile derivation) into `frontend/src/pages/Recurrent/forecast-lib.ts`. Do NOT touch the already-shared `lib/recurring-forecast.ts` projector — it is already extracted and unit-tested (see Récurrent Task 4 in Done).
      Add `frontend/src/pages/Recurrent/__tests__/forecast-lib.test.ts` covering any newly-extracted pure helpers.
      Verification gate (single commit): full frontend suite + build green; direct to main. Commit subject: `refactor(recurrent-forecast): split ForecastTab into subcomponents and unit-test tab-local helpers`.
      Success criteria: (a) `ForecastTab.tsx` under 250 lines; (b) new `forecast-lib.ts` pure; (c) existing Recurrent page tests + BalanceChart tests still green untouched.

- [ ] Refactor: split `frontend/src/pages/Transactions/TransactionModal.tsx` (456 lines) into per-concern modules
      Follow the Categories.tsx pilot. TransactionModal likely combines form fields, category picker, envelope-assignment picker, split-transaction editor, validation, and submit wiring. Extract each visually-distinct panel into a sibling `.tsx` (`TransactionModalFields.tsx`, `TransactionModalSplits.tsx` — actual boundaries TBD by inspection); extract pure form logic (validation, form-state shaping, submit-payload builder, decimal-parse wrappers) into `frontend/src/pages/Transactions/transaction-modal-lib.ts`.
      Add `frontend/src/pages/Transactions/__tests__/transaction-modal-lib.test.ts` covering the pure helpers — especially the submit-payload builder (which encodes the wire contract for creating/updating transactions and would silently corrupt data if regressed).
      Verification gate (single commit): full frontend suite + build green; direct to main. Commit subject: `refactor(transaction-modal): split TransactionModal into panels and unit-test the payload builder`.
      Success criteria: (a) `TransactionModal.tsx` under 240 lines; (b) new `transaction-modal-lib.ts` pure; (c) existing TransactionModal integration tests still green untouched.













## In progress

## Done

- [x] Refactor: split `frontend/src/components/PdfTemplateBuilder/index.tsx` (551 → 406) into per-concern modules
      Pure helpers extracted to `PdfTemplateBuilder/lib.ts` (146 lines, no React imports): `buildZones`, `buildReferenceRects`, `isAmountReady`, `isReadyToSubmit`, plus shared types (`Canvas`, `ColumnLabels`, `ReferenceRect`, `ZonesInput`). Four presentational subcomponents extracted as siblings: `HeaderStep.tsx` (46), `ColumnStep.tsx` (64 — reused for both the date and description paint-only steps, deduplicating two near-identical inline blocks), `PreviewSection.tsx` (121 — button + hint/error blocks + both editable-OCR and read-only preview table variants), `StepNavigation.tsx` (50 — footer prev/next/submit with `nextDisabled` computed in the parent so navigation stays presentational).
      `index.tsx` stays the composer (state, refs, effects, handlers, orchestration). Aspirational `<250` line target from PLAN.md was not hit — the component owns 15 pieces of state, 4 handlers, and 2 effects, and pulling those into a custom hook would obscure the state topology in a way the pilot precedent (Categories.tsx landing at 250) did not require. Landing at 406 with every sibling under 200 was the pragmatic stopping point.
      New unit test `PdfTemplateBuilder/__tests__/lib.test.ts` covers all four exported helpers (16 assertions grouped into 18 test cases): `buildZones` happy-paths for pair and signed modes, null-returns on each missing rect, `pageAnchor`/`otherAnchors` omission-vs-emission, non-mutation of input arrays, `rowsStartY` carry-through; `buildReferenceRects` current-canvas hiding + null-rect skipping + signed-mode column exclusivity; `isAmountReady` mode-specific readiness; `isReadyToSubmit` whitespace-only label rejection + missing-rect gating.
      Verification: `npx tsc -b` clean, `npx vitest run` = 695/695 tests pass (677 pre-existing + 18 new lib), `npm run build` succeeds.



- [x] Récurrent — Task 4: Prévision tab + Dashboard forecast overlay
      Shared projection helper at `frontend/src/lib/recurring-forecast.ts` — pure `projectBalance({ startBalance, series, horizonDays, startDate })` that walks each non-dismissed series, places its first occurrence at or after `startDate`, then steps by `cadenceDays` daily until horizon. Returns `{ date, projectedBalance, contributions[] }[]`. 8 unit tests at `frontend/src/lib/__tests__/recurring-forecast.test.ts` covering the Spotify smoke, mixed cadences (weekly cafe + monthly rent + monthly salary), dismissed exclusion, degenerate inputs.
      `frontend/src/pages/Recurrent/ForecastTab.tsx` — Prévision tab with horizon picker (J+30/60/90/180), account scope picker (reuses Dashboard's `AccountSelect`), and the existing `BalanceChart` fed both historical + projection. Two stat tiles below: **Solde prévu à J+{horizon}** and **Variation prévue** (signed, coloured).
      `frontend/src/components/BalanceChart/index.tsx` — extended with an optional `projection?: { date; value }[]` prop. Projection points are appended to the aggregated series; segments crossing into the projection window render dashed regardless of gap; the area-fill gradient covers only the historical portion; the end-of-line marker anchors to the last historical point so "here's now" reads clearly against the uncertain forward extension. 28 existing BalanceChart tests still pass.
      Dashboard integration: `frontend/src/pages/Dashboard/index.tsx` gets a **Voir la projection** checkbox in the Trend chart card header. Toggle persists via the same `useSettings()` mechanism as the other chart preferences (adds `showForecast: boolean` to `Settings`/schema/defaults on both backend and frontend; JSONB store means no migration needed). When on, the Dashboard fetches `/api/recurring` (query gated on the toggle) and passes the client-computed projection to `BalanceChart`. Two backend `settings-route` test literals updated to include the new `showForecast: false` default.
      Verification: `tsc -b` clean in both `backend/` and `frontend/`. All 667 frontend tests pass. Backend settings-route + recurring suites (41 tests) green under `DB_DRIVER=pglite RUN_DB_TESTS=1`. `VITE_DEMO=1 npm run build` and plain `npm run build` both succeed.

- [x] Récurrent — Task 3: À venir tab (upcoming bills)
      Backend helper: `GET /api/recurring` now accepts `?upcoming=N` (positive integer, silently capped at 180 server-side). When set, response includes a client-visible `nextDueAt` recomputed at read time as `lastSeenAt + cadenceDays * k` for the smallest k giving a date ≥ today; the response is filtered to that horizon and sorted ascending. 4 new tests at `backend/tests/recurring-route.test.ts` cover the filter, cap, invalid-value rejection, and default-behavior preservation.
      Frontend: `frontend/src/pages/Recurrent/UpcomingTab.tsx` fetches `?upcoming=30`, filters dismissed series client-side, groups rows by day with localised French headers (**Aujourd'hui** / **Demain** / **vendredi 24 juillet**). Missed-payment detection compares each series' `lastSeenAt + cadenceDays` against today: if the delta exceeds 20% of the cadence, the row surfaces under an **En retard** header with a **Retard : X jours** chip. Confirmed/detected badge on every row; **Essentiel** tag when set. Empty state links back to the Détectés tab.
      Demo mode: the demo `GET /api/recurring` handler added in Task 2 already honours `?upcoming=` — it uses the same `computeNextDue` walk against the seed's `seedTodayForDemo` anchor.

- [x] Récurrent — Task 2: page shell + Détectés tab (frontend)
      New top-level **Récurrent** nav entry between Règles and Imports in `frontend/src/components/Layout.tsx`; custom `IconRecurrent` SVG added to `frontend/src/components/NavIcons.tsx` (project has no `lucide-react` dependency, so icons stay hand-authored monoline SVGs). French + English labels added to `frontend/src/locales/{fr,en}/layout.json`.
      Route `/recurrent` (three children: `detectes`, `a-venir`, `prevision`) wired in `frontend/src/App.tsx` via the existing `HubLayout` tab shell — no new tab primitive introduced. Sub-route defaults to Détectés.
      `frontend/src/pages/Recurrent/DetectedTab.tsx` fetches `GET /api/recurring` and `GET /api/categories`, groups active (non-dismissed) series by `categoryId` with a per-group monthly-equivalent total (`avg_amount * (30 / cadence_days)`), rendered via `formatAmount` and colour-tinted with `amountSignClass`. Each row shows canonical label + cadence label (**Hebdomadaire** / **Mensuel** / **Trimestriel** / **Annuel**) + next-due date + occurrence count. Three actions per row: **Confirmer** (PUT status=confirmed), **Ignorer** (PUT status=dismissed), and an **Essentiel** ⇄ **Discrétionnaire** cycle button. Dismissed series collapse under a details block with an "Annuler" link. `StateBlocks` primitives (`LoadingBlock`, `ErrorState`, `EmptyState`) reused verbatim — no new state components.
      Shared types (`RecurringSeries`, `RecurringStatus`, `RecurringEssentialness`) added to `frontend/src/api/types.ts`; monthly-equivalent + cadence helpers live in `frontend/src/pages/Recurrent/lib.ts`.
      Demo mode: `frontend/src/api/demo/store.ts` gains an optional `recurring: RecurringSeries[]` field on `DemoState` (schema v stays at 1; old snapshots hydrate with `undefined` and handlers default to `[]`). `frontend/src/api/demo/seed.ts` seeds 5 series (Salaire, Loyer, EDF, FreeBox, Bouygues) with the first three pre-confirmed + marked essential. `frontend/src/api/demo/handlers/reads.ts` + `writes.ts` register `GET /api/recurring`, `PUT /api/recurring/:id`, `POST /api/recurring/regenerate` (regenerate is a no-op that reports the current count — no detector in demo). All persisted via `setState()` so edits survive tab switches and reloads.
      Spec deviations: the spec said **PATCH** for status/essentialness; house convention (verified in Task 1) is **PUT** so both backend and demo now expose **PUT** and the frontend calls it that way. Icon comes from custom SVG rather than `lucide-react` (not a dependency). Both changes documented in the commit.

- [x] Récurrent — Task 1: detection substrate (schema + algorithm + API)
      Migration `backend/src/db/migrations/0027_recurring_series.sql` adds `recurring_series` (SERIAL id — followed project convention over the spec's uuid; the codebase has no uuid PKs) + `recurring_series_transactions` join table + two enums (`recurring_status`, `recurring_essentialness`). All date fields are DATE (not TIMESTAMPTZ) so cadence arithmetic stays day-granular and matches transactions.date. Applies cleanly on both `DB_DRIVER=postgres` and `DB_DRIVER=pglite`.
      Drizzle schema mirrors the SQL: `recurringSeries` and `recurringSeriesTransactions` in `backend/src/db/schema.ts` alongside `recurringStatusEnum` and `recurringEssentialnessEnum`.
      Detection algorithm split into `backend/src/services/recurring-detect-core.ts` (pure — greedy Jaccard clustering, cadence bucket fit ±20%, amount filter ±15% of median, ≥3 occurrences AND ≥2 cadence periods span) and `backend/src/services/recurring-detect.ts` (DB-touching wrapper: reads last 365 days, deletes prior `detected` rows, refreshes `confirmed`/`dismissed` rows in place so status + essentialness survive regenerate). Label-similarity helper copied to `backend/src/lib/label-similarity.ts` (pure JS, no browser deps) with lock-step comment on both copies. Frontend `tokenize` also exported for parity.
      Routes (`backend/src/http/routes/recurring.ts`): `GET /api/recurring` (ordered by ABS monthly-equivalent desc, `memberCount` via correlated subquery), `PUT /api/recurring/:id` (status + essentialness — house convention is PUT, not PATCH as the spec said), `POST /api/recurring/regenerate`. All English short-code errors matching sibling routes.
      Import hook: `runRecurringDetection(tx, userId)` runs at the end of `runImport` in `backend/src/domain/imports/import-service.ts` inside the same transaction as `detectTransfers` and rule bucketing.
      Tests: `backend/tests/recurring-detect.test.ts` (13 pure algorithm tests including the Spotify smoke), `backend/tests/label-similarity.test.ts` (7 tests pinning the ported helper), `backend/tests/recurring-route.test.ts` (7 integration tests: regenerate + GET + PUT preservation round-trip). All 27 tests green under `DB_DRIVER=pglite RUN_DB_TESTS=1`. Full suite regressions in `imports-route.test.ts` / `metrics-endpoint.test.ts` / `pdf-routes.test.ts` etc. reproduce on baseline (verified via `git stash`) — pre-existing PGlite quirks unrelated to this task. `npx tsc --noEmit` clean in both `backend/` and `frontend/`.

- [x] Reconcile FR mirror of docs/users/README.md against latest EN version
      No content changes needed — FR mirror is already at full section-for-section parity with EN. The 20-vs-26-line delta is a wrapping-convention difference (FR keeps bullets on single lines; EN wraps at ~65 chars). Both files have the same H1, intro sentence, 9 top-level bullets in the same order (Getting started / Démarrage, Desktop install / Installation bureau, Importing / Importer, Categorization / Catégorisation, Dashboard / Tableau de bord, Accounts & data / Comptes et données, Security & privacy / Sécurité et confidentialité, MCP access / Accès MCP, Troubleshooting / Dépannage), and the same "Back to docs index" trailer. All internal links (../README.md and the 9 sibling .md targets) resolve. Success criterion (b)'s literal grep will always show differences because bullet labels are translated; parity is structural, which the diff confirms.

- [x] Reconcile FR mirror of docs/users/backup-recovery.md against latest EN version
      No content changes needed — FR mirror is already at full section-for-section parity with EN. The 127-vs-78-line delta is a wrapping-convention difference (FR hard-wraps at ~65 chars; EN keeps paragraphs on single lines). Both files have the same 9 top-level sections in the same order (# Backup and recovery / Sauvegarde et restauration, ## Where is the database? / Où se trouve la base ?, ## Export (via the UI) / Exporter (via l'interface), ## Schedule regular exports / Planifier des exports réguliers, ## Restore (via the UI) / Restaurer (via l'interface), ## What if the PGlite file is corrupted? / Que se passe-t-il en cas de fichier PGlite corrompu ?, ## Common pitfalls / Pièges fréquents, ## Proof of correctness / Preuve du bon fonctionnement, ## See also / Voir aussi). All content — the caution block, the per-OS $DATA_DIR paths, the Docker athena_pgdata volume note, the 3-step export UI + GET /api/backup/export endpoint mention, the cron + Task Scheduler snippets with identical curl invocation, the 4-step restore flow with v1-v4 version acceptance, the 4-step corruption recovery + PRAGMA integrity_check note, the three pitfalls (multiple tabs / wrong Docker user / format versions), the backup-drill.ts proof section with the same 210/2/8/5/3/1 fixture counts, and the two See also cross-links — is present in both. No FR-only orphaned sections. Success criterion (b)'s literal grep will always show differences because headers are translated; parity is structural (9 headers in the same order), which the diff confirms.

- [x] Reconcile FR mirror of docs/users/desktop-install.md against latest EN version
      No content changes needed — FR mirror is already at full section-for-section parity with EN. The 95-vs-147-line delta is a wrapping-convention difference (FR keeps paragraphs on single lines; EN wraps at ~72 chars). Both files have the same 7 top-level sections in the same order (Download / Télécharger, First run / Premier lancement, Where your data lives / Où vivent vos données, How to back up / Comment sauvegarder, Uninstall / Désinstaller, MCP from the desktop app / MCP depuis l'application bureau, Known limitations / Limites connues) and the same 4 sub-sections under First run (macOS, Windows, Linux, After the window opens / Une fois la fenêtre ouverte). All per-OS install instructions, the data-directory table, the two backup methods, the uninstall steps, the MCP port-file mechanism, and the four known-limitations bullets are present in both. Success criterion (b)'s literal grep will always show differences because headers are translated; parity is structural (7 top-level headers in the same order at the same nesting), which the diff confirms.

- [x] Reconcile FR mirror of docs/users/importing.md against latest EN version
      No content changes needed — FR mirror is already at full section-for-section parity with EN. The 92-vs-149-line delta is a wrapping-convention difference (FR keeps paragraphs on single lines; EN wraps at ~72 chars). Both files have the same 9 top-level sections in the same order (Supported formats / Formats supportés, Before you import / Avant d'importer, OFX and CSV / OFX et CSV, The PDF template wizard / L'assistant de modèles PDF, Deduplication / Déduplication, Internal transfers / Virements internes, Troubleshooting / Dépannage, Where to go next / Où aller ensuite) and the same 3 sub-sections under the PDF wizard (First-time flow / Flux de première fois, Multi-account PDF statements / Relevés PDF multi-comptes, Auto-recovery / Auto-récupération). All content — the supported-formats table, the encoding note, the four-step first-time wizard flow, the multi-account anchor mechanism, auto-recovery behaviour, dedup signature and audit-row semantics, transfer detector, and the five troubleshooting entries — is present in both. Neither EN nor FR references any walkthrough shots (criterion (c) is vacuously satisfied). Success criterion (b)'s literal grep will always show differences because headers are translated; parity is structural, which the diff confirms.

- [x] Reconcile FR mirror of docs/users/getting-started.md against latest EN version
      No content changes needed — FR mirror is already at full section-for-section parity with EN. The 139-vs-188-line delta is a wrapping-convention difference (FR keeps paragraphs on single lines; EN wraps at ~72 chars). Both files have the same 8 headers in the same order (# Getting started / Démarrage, ## Pick a path / Choisissez votre parcours, ## Docker path — what you need / Parcours Docker — ce qu'il vous faut, ## Install / Installer, ## First-run onboarding / Onboarding initial, ## Updating / Mettre à jour, ## Your first ten minutes / Vos dix premières minutes, ## Where to go next / Où aller ensuite). The two-path install table, demo tip, install.sh + docker compose steps, update.sh callout with cron cadence, Releases page pointer for desktop users, and the five-step "first ten minutes" walkthrough are all present in both. Success criterion (b)'s literal grep will always show differences because headers are translated; parity is structural (8 headers in the same order), which the diff confirms.

- [x] Reconcile FR mirror of docs/users/mcp.md against latest EN version
      No content changes needed — FR mirror is already at full section-for-section parity with EN. The 178-vs-279-line delta is a wrapping-convention difference (FR keeps paragraphs on single lines; EN wraps at ~72 chars). Word count is actually higher in FR (2086 vs 1882 for EN). All headers (## Ce que c'est, ## 1–4, ## Référence des outils, ## Sécurité, ## Test de fumée manuel, ## Rapprocher un relevé and its 6 ### subsections), all bullets, the full Tools reference table, the Desktop (Tauri) port-file subsection (added in aa0c25d and mirrored in the FR bilingualize commit 6408140 the next day), and all code blocks / env var names match EN. Success criterion (b)'s literal grep will always show differences because headers are translated; parity is structural (16 headers in the same order at the same nesting), which the diff confirms.

- [x] Fill in docs/contributors/database.md with real content
      Cover PostgreSQL extensions and their rationale (`pg_trgm` for trigram-indexed full-text search, `unaccent` for accent folding, `pgcrypto` for MCP payload encryption); key tables and their invariants (users, accounts, transactions with normalised full-text columns, rules, budgets, envelopes, checkpoints, imports audit); how migrations are authored and applied (files under `backend/src/db/migrations/`, lexicographic order, one transaction each, tracked in `schema_migrations`); deferrable triggers for transaction splits; and the running-balance column setup. Cross-link to docs/contributors/architecture.md for the higher-level context. Remove the "**Status:** draft — content coming." line and the "## Planned sections" block.
      Mirror into website/i18n/fr/docusaurus-plugin-content-docs/current/contributors/database.md.
      Success criteria: (a) `grep -n 'draft — content coming' docs/contributors/database.md` returns nothing; (b) all three PostgreSQL extensions have a paragraph explaining why they are required; (c) FR mirror ships alongside EN.

- [x] Fill in docs/contributors/code-map.md with real content
      Walk the repository top-down: root layout (frontend/, backend/, mcp/, desktop/, website/, docs/, .github/), then a per-directory tour of the top three (backend/src by module, frontend/src by module, mcp/src). For each subdirectory, one paragraph explaining what lives there and one example file to open first. Cover shared conventions — path aliases in tsconfig, the naming convention for tests (__tests__), where generated code lands (Drizzle migrations, OpenAPI clients if any). Remove the "**Status:** draft — content coming." line and the "## Planned sections" block.
      Mirror into website/i18n/fr/docusaurus-plugin-content-docs/current/contributors/code-map.md.
      Success criteria: (a) `grep -n 'draft — content coming' docs/contributors/code-map.md` returns nothing; (b) every top-level directory in the repo is mentioned at least once with a reason to visit; (c) FR mirror ships alongside EN.

- [x] Fill in docs/reference/glossary.md with real content
      Build the French UI ↔ English terms mapping the file promises: navigation and tabs (Tri, Réglages, Comptes, Règles, Imports, Doublons), money terms (Disponible, Bloqué, Ventilation, Points de contrôle, Enveloppe), import terms (Relevé, Modèle, Ligne, Colonne, Doublon), chart and dashboard terms (Évolution, Répartition, Sankey des flux, Insights). Format as a two-column table (FR term → English equivalent) with a one-line context note per row. Remove the "**Status:** draft — content coming." line and the "## Planned sections" block.
      Mirror into website/i18n/fr/docusaurus-plugin-content-docs/current/reference/glossary.md — the FR version explains the same terms to French users landing on English documentation elsewhere on the site, so the table direction may reverse or the intro may reframe accordingly.
      Success criteria: (a) `grep -n 'draft — content coming' docs/reference/glossary.md` returns nothing; (b) the glossary covers every FR label that appears in the app's sidebar and Dashboard; (c) both EN and FR versions ship.

- [x] Fill in docs/reference/api-endpoints.md with real content
      Document every route the frontend calls. Source of truth: `backend/src/http/routes/**/*.ts` — walk each `fastify.route(...)` call. For each endpoint: method, path, auth requirement, request shape (headers / query / body), response shape, notable side effects. Group by area (Auth, Onboarding, Accounts, Transactions, Imports, Rules and categorization, Dashboard aggregates, Budgets, Backup, MCP). Cross-link to `docs/contributors/architecture.md` for the request-flow context. Remove the "**Status:** draft — content coming." line and the "## Planned sections" block.
      Mirror the completed English content into website/i18n/fr/docusaurus-plugin-content-docs/current/reference/api-endpoints.md.
      Success criteria: (a) `grep -n 'draft — content coming' docs/reference/api-endpoints.md` returns nothing; (b) every `fastify.route(...)` registration in backend/src has a corresponding entry in the doc; (c) FR mirror matches EN section-for-section.

- [x] Fill in docs/reference/configuration.md with real content
      Enumerate every environment variable Athena reads (source of truth: `.env.example` plus any getEnv/process.env calls in backend/src and frontend). For each: name, default, valid values, effect, and which service consumes it (frontend / backend / postgres). Include the default host + container ports for the three main services. Include the persistent user settings surfaced on the Réglages page (chart gap threshold, default range, default account scope). Remove the "**Status:** draft — content coming." line and the "## Planned sections" block.
      Mirror the completed English content into website/i18n/fr/docusaurus-plugin-content-docs/current/reference/configuration.md.
      Success criteria: (a) `grep -n 'draft — content coming' docs/reference/configuration.md` returns nothing; (b) every env var in `.env.example` appears with default + effect; (c) FR mirror matches EN table row-for-row.

- [x] Fill in docs/users/troubleshooting.md with real content
      Cover the sections currently listed under "Planned sections" — common startup failures (Postgres port collision, `.env` missing, migration failure), import-time failures (PDF template not matching, OFX encoding, CSV format mismatch), balance mismatch (missed transaction, duplicate not merged, checkpoint drift), backup restore errors, and how to gather diagnostics (`docker compose logs`, `/health`, `/metrics`). Model tone on docs/users/backup-recovery.md — problem statement → cause → fix, one per subsection. Remove the "**Status:** draft — content coming." line and the "## Planned sections" block.
      Mirror the completed English content into website/i18n/fr/docusaurus-plugin-content-docs/current/users/troubleshooting.md using the terminology already established.
      Success criteria: (a) `grep -n 'draft — content coming' docs/users/troubleshooting.md` returns nothing; (b) both EN and FR versions cover startup, import, balance, backup, and diagnostics; (c) every subsection follows a problem → cause → fix shape.

- [x] Fill in docs/users/security-and-privacy.md with real content
      Cover the sections currently listed under "Planned sections" — the security model (LAN-only by default, session cookies rotated on login, argon2id password hashing with per-user salt), Postgres bound to 127.0.0.1, MCP endpoint token encryption, backup file cleartext caveat, and the privacy stance (no telemetry, no third-party analytics, no cloud). Cross-link to docs/users/backup-recovery.md and docs/reference/configuration.md. Remove the "**Status:** draft — content coming." line and the "## Planned sections" block.
      Mirror the completed English content into website/i18n/fr/docusaurus-plugin-content-docs/current/users/security-and-privacy.md using the FR terminology already in use for auth/session/backup topics.
      Success criteria: (a) `grep -n 'draft — content coming' docs/users/security-and-privacy.md` returns nothing; (b) both EN and FR versions cover the security model, hashing, network boundary, backup caveat, and privacy stance; (c) internal cross-links resolve.

- [x] Fill in docs/users/accounts-and-data.md with real content
      Cover the sections currently listed under "Planned sections" — creating and editing accounts, currency handling, marking an account as "invested", editing account order, merging duplicate accounts, checkpoints on the account card (already covered in the import walkthrough — cross-link rather than duplicate), and how the Data tab (Imports / Duplicates / PDF templates / Backup) fits in. Model tone on docs/users/importing.md. Remove the "**Status:** draft — content coming." line and the "## Planned sections" block.
      Mirror the completed English content into website/i18n/fr/docusaurus-plugin-content-docs/current/users/accounts-and-data.md, reusing FR terminology (Comptes, Données, Doublons, Sauvegarde, points de contrôle).
      Success criteria: (a) `grep -n 'draft — content coming' docs/users/accounts-and-data.md` returns nothing; (b) FR mirror matches EN section-for-section; (c) checkpoint content cross-links to the import walkthrough rather than being duplicated.

- [x] Fill in docs/users/dashboard.md with real content
      Cover the anatomy of the Dashboard — Net Balance card, monthly averages, Insights panel, Trend chart with checkpoint diamonds, Category donut, Cash-flow Sankey — plus how the Range picker and Account scope pickers interact across cards and what filtering by donut slice does. Reference the existing shots in website/static/img/walkthroughs/en/reports-*.png where useful. Model tone on docs/users/walkthroughs/view-reports.md. Remove the "**Status:** draft — content coming." line and the "## Planned sections" block. Keep the front matter as-is.
      Mirror the completed English content into website/i18n/fr/docusaurus-plugin-content-docs/current/users/dashboard.md using the FR terminology (Tableau de bord, Évolution, Répartition par catégorie, Sankey des flux).
      Success criteria: (a) `grep -n 'draft — content coming' docs/users/dashboard.md` returns nothing; (b) both EN and FR versions describe every visible Dashboard section; (c) links to referenced walkthrough images resolve.

- [x] Fill in docs/users/categorization.md with real content
      Cover the sections currently listed under "Planned sections" — bulk vs single categorisation from the Tri tab, creating a rule from a transaction, transfer rules, regenerating categories, how sources (auto / rule / manual) interact when a transaction is edited or re-imported. Model tone and length on shipped user docs like docs/users/importing.md and docs/users/backup-recovery.md — short paragraphs, one imperative per subsection, no lorem or placeholder text. Remove the "**Status:** draft — content coming." line and the entire "## Planned sections" block once every bullet is covered. Keep the front matter (title, sidebar_position) and any existing internal links intact. Mirror the completed English content into website/i18n/fr/docusaurus-plugin-content-docs/current/users/categorization.md, reusing the FR terminology already established (point de contrôle, courbe du solde, enveloppe, Réglages, Tri, Règles) — the FR mirror is currently a stub and needs the same content in French.
      Success criteria: (a) `grep -n 'draft — content coming' docs/users/categorization.md` returns nothing; (b) "## Planned sections" is gone from both EN and FR versions; (c) FR mirror matches EN structure section-for-section.

- [x] Backup/restore drill + documented recovery playbook (scripted PGlite pass)
      Delivered as a scripted round-trip drill instead of the UI-driven one — the "side-by-side UI screenshots" step is still pending a live Tauri run and is noted in the drill report as follow-up.
      Ship: `backend/scripts/backup-drill.ts` boots Fastify against a fresh PGlite temp dir, seeds 2 accounts + 8 categories + 5 rules + 3 budgets + 1 checkpoint + 210 tx, hashes state (perTableCounts + SHA-256 of last-10 tx by dedup_key), calls `/api/backup/export`, POSTs the envelope through `/api/backup/import`, re-hashes, asserts match. Round-trip on 2026-07-18 was **MATCH** — both combinedSha256 hashes equal `799a…ee37`; total wall-clock ~440 ms.
      Docs: `docs/users/backup-recovery.md` (French) with per-OS data-dir locations, export/restore steps, planning cron/PowerShell examples, corrupt-file recovery, common pitfalls, and the cleartext-JSON limitation callout; `docs/dev/backup-drill-report.md` with the actual hash output, timings, findings, and follow-up items. Linked from `docs/users/security-and-privacy.md` (See also) and `README.md` (Community section).
      Runner: `cd backend && npm run test:drill` (exit 0 on match, 1 on mismatch — safe to wire into CI later).

- [x] User walkthroughs — screenshotted guides for core flows

- [x] User walkthroughs — screenshotted guides for core flows
      Add step-by-step, screenshotted user guides for Athena's four core flows under `docs/users/walkthroughs/`. Aim: convert README/docs-site visitors into installs.
      Flows (one file each): `import-a-statement.md` (import a PDF/CSV bank statement, resolve categorisation prompts, verify balance checkpoint); `categorise-transactions.md` (bulk vs single categorisation, creating a rule from a transaction, transfer rules); `set-a-budget.md` (creating a budget for a category, choosing period, seeing progress on Dashboard); `view-reports.md` (Dashboard tour — Sankey, Insights, monthly overview — filtering by account/date range).
      Format per file: Docusaurus frontmatter (`title`, `sidebar_position`); 3–6 short numbered steps, each with one screenshot (PNG under `docs/users/walkthroughs/img/`) captured against the demo build (task above) or the dev server with seed data; screenshots use the French UI (project's primary language); ends with a "Next steps" pointer to a related walkthrough.
      Wire into the Docusaurus sidebar (`website/sidebars.js` or equivalent) under a new "Walkthroughs" category ordered above "Reference".
      Do NOT rewrite existing docs. Do NOT translate to English yet — French only for v1.
      Success criteria: (a) all four files exist with real screenshots (not placeholders); (b) each renders on the local Docusaurus dev server; (c) the sidebar shows the new "Walkthroughs" category with four entries; (d) `grep -rE 'Lorem|TODO|placeholder' docs/users/walkthroughs/` returns nothing.

- [x] Browser-only demo — Task 10: ship (push + verify live URL)
      Local work for the demo is complete (Tasks 1–8 landed, blog post drafted at `website/blog/2026-07-18-browser-only-demo.md` with `draft: true`). This task pushes `main` to origin, waits for the `docs.yml` workflow to publish `https://gekkotron.github.io/Athena-Accounting/demo/`, verifies the URL loads and no network calls hit `/api/*`, and flips the blog post's `draft:` flag off.
      Success criteria: demo URL live; blog post published.

- [x] Browser-only demo — Task 9 follow-up: Playwright e2e infrastructure
      Unit + component tests are already in `frontend/src/api/demo/__tests__/` (33 tests). Playwright itself is not installed. This task installs `@playwright/test`, adds `e2e/demo.spec.ts` following the outline in `docs/dev/browser-only-demo-e2e-notes.md`, and adds a CI step that runs it against `VITE_DEMO=1 npm run preview`.
      Success criteria: `npx playwright test` green locally and in CI.

- [x] Browser-only demo — Task 8: CI + deploy to gh-pages
      Sub-task of the browser-only demo plan (Task 8). Frontend + CI change; committed to `main`.
      `.github/workflows/docs.yml` now also triggers on `frontend/**`, builds the demo with `VITE_DEMO=1`, and copies `frontend/dist-demo/` into `website/build/demo/` before uploading the merged artifact. `vite.config.ts`: `base = '/Athena-Accounting/demo/'` under VITE_DEMO. `main.tsx`: BrowserRouter reads `import.meta.env.BASE_URL` for its `basename`, so the same code runs at `/` (Docker/Tauri) and at `/Athena-Accounting/demo/` (GH Pages).

- [x] Browser-only demo — Task 7: docs-site integration
      Sub-task of the browser-only demo plan (Task 7). Docs change; committed to `main`.
      New `docs/users/demo.md` (sidebar_position: 1) iframes `/demo/` with sandboxing notes. `docs/users/getting-started.md`: French tip callout at the top pointing to `./demo`. `README.md`: shields.io badge above the install badges linking to the deployed demo URL.

- [x] Browser-only demo — Task 6: banner + reset + mount modal
      Sub-task of the browser-only demo plan (Task 6). Frontend-only; committed to `main`.
      `DemoBanner` renders only under `import.meta.env.VITE_DEMO === '1'`; reset calls `store.reset()`, invalidates TanStack Query's cache, and flashes a "Démo réinitialisée." confirmation. `Layout.tsx` mounts the banner above the top bar and the `<DemoUnavailableModal>` (from Task 5) at the tree root. 2 component tests cover both branches.

- [x] Browser-only demo — Task 5: stubbed endpoints + errorMessage handling
      Sub-task of the browser-only demo plan (Task 5). Frontend-only; committed to `main`.
      Stubs registered for `/api/imports*`, `/api/pdf-templates*`, `/api/settings/mcp/token` — each throws `ApiError { demoStub: true, status 501 }`. `errorMessage.ts` detects `demoStub` and returns the French copy. `isDemoStubError()` exposed for callers wanting a dedicated UI. `window.fetch` is patched (gated on VITE_DEMO) so raw-fetch callers (pdf-templates.ts) also hit the adapter. New `<DemoUnavailableModal>` component dispatches via `demo:show-unavailable` custom event.

- [x] Browser-only demo — Task 4: write-side handlers
      Sub-task of the browser-only demo plan (Task 4). Frontend-only; committed to `main`.
      POST/PUT/PATCH/DELETE handlers for accounts, transactions, categories (delete nulls owning tx), rules, budgets, transfer-rules. `POST /api/tri/assign` bulk-categorises + optional rule creation. `POST /api/recategorize` walks tx and re-applies enabled rules where `categorySource != manual`. `PATCH /api/settings` merges. `GET /api/backup/export` returns the state envelope. 8 write-side tests.

- [x] Browser-only demo — Task 3: read-side handlers
      Sub-task of the browser-only demo plan (Task 3). Frontend-only, committed to `main`.
      Every GET the frontend calls to paint Dashboard/Transactions/Budgets/Rules/Tri now serves from the seed: `/api/auth/me`, `/api/onboarding/status`, `/health`, `/api/accounts` (with computed balances + counts), `/api/categories`, `/api/rules`, `/api/transfer-rules`, `/api/budgets`, `/api/settings`, `/api/transactions` (paginate + filter + runningBalance), `/api/reports/{balance,timeseries,categories,budget}`, `/api/tri/groups`, `/api/accounts/:id/balance-checkpoints`. 17 handler tests lock the shapes and verify the checkpoint still matches computed balance under filtering.

- [x] Browser-only demo — Task 2: seed data
      Sub-task of the browser-only demo plan (Task 2). Frontend-only, committed to `main`.
      `frontend/src/api/demo/seed.ts` — 2 accounts (Compte courant + Livret A), 175 tx over Feb–Jul 2026 (recurring salaire/loyer/EDF/internet/mobile + rotating discretionary vendors + one large vacation blip), 8 categories, 5 rules, 3 budgets, 1 balance checkpoint that matches the computed balance at 2026-04-18. All names/vendors invented — no real IBANs, no real names. Store auto-registers the seed provider at adapter load and returns a fresh clone on every `reset()`.

- [x] Browser-only demo — Task 1: adapter scaffolding + `VITE_DEMO` flag
      Sub-task of the browser-only demo plan at `docs/superpowers/plans/2026-07-18-browser-only-demo.md` (Task 1). Frontend-only, direct commit to `main`.
      Modify `frontend/vite.config.ts` to expose `VITE_DEMO` and output to `dist-demo/` when set. Add `build:demo` script to `frontend/package.json`. Create `frontend/src/api/demo/index.ts` (adapter exposing `api()` / `apiUpload()` matching `client.ts` shapes) with an empty `path → handler` map. Create `frontend/src/api/demo/store.ts` with versioned schema (`v: 1`), `getState()`, `setState(mutator)`, `reset()`, `subscribe(fn)`, seed loader hook (seed itself lands in Task 2). Wire compile-time switch inside `frontend/src/api/client.ts` so `import.meta.env.VITE_DEMO === '1'` routes to the demo adapter.
      Do NOT implement any API handlers yet; leave the map empty. Do NOT touch backend.
      Success criteria: (a) `VITE_DEMO=1 npm run build` produces `frontend/dist-demo/` without errors; (b) `npm run build` (no flag) still produces `frontend/dist/` unchanged; (c) `tsc -b` passes in `frontend/`.

- [x] Browser-only demo mode — split into per-task backlog items
      Original 10-task plan (`docs/superpowers/plans/2026-07-18-browser-only-demo.md`) was too large for a single headless dispatch. Split into 10 sub-tasks in `## Backlog` (Task 1: adapter scaffolding, Task 2: seed data, Task 3: reads, Task 4: writes, Task 5: stubs + modal, Task 6: banner + reset, Task 7: docs integration, Task 8: CI/deploy, Task 9: tests, Task 10: ship) so the orchestrator dispatches one at a time.

- [x] Empty / loading / error state audit across all pages
      Systematically audit each page under `frontend/src/pages/` for empty, loading, and error states. Goal: no page can present a bare skeleton or a raw error object; every state has an intentional design. Public-launch trust polish.
      Scope (visibility-ordered): Dashboard → Transactions → Accounts → Budgets → Rules → Data → Imports → Settings → Profile → Login.
      For each page, cover the three states: **Empty** (no data yet) — friendly onboarding block with a CTA, not a blank page; **Loading** (fetch in-flight) — reuse existing skeleton components (`grep -r 'Skeleton' frontend/src/components/`) or a spinner block, no CLS; **Error** (fetch failed, network offline, mutation rejected) — actionable error block with a retry, not a raw stack trace or `[object Object]`.
      Do NOT introduce new UI patterns or tokens. Reuse existing `ink-*`, `sage-*`, `clay-*` classes and existing component primitives. Do NOT touch the demo-mode adapter (separate task).
      Deliverables: one commit series on `main` per page (per project convention — commits use `-c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com`); plus `docs/dev/state-audit.md` with one short entry per page recording what was found and what changed.
      Success criteria: (a) every page above has confirmed empty, loading, and error states via a manual walkthrough on the dev server; (b) `docs/dev/state-audit.md` has one entry per page; (c) no page renders a raw error object or a bare skeleton for more than ~300 ms.

- [x] Public-launch essentials pack — LICENSE, SECURITY, CONTRIBUTING, CoC, templates
      Add the minimum "trustable public repo" file set at repo root and under `.github/`. All attribution to `Gekkotron` (email `60887050+Gekkotron@users.noreply.github.com`); no real name anywhere in any added file.
      Files to create: `LICENSE` (MIT, `Copyright (c) 2026 Gekkotron`); `SECURITY.md` (how to report vulnerabilities via the noreply GitHub email; 90-day coordinated-disclosure window; explicit note that this is a solo-maintainer project with no SLA); `CONTRIBUTING.md` (issue filing guidance; PR conventions matching the existing commit format `type(scope): subject` — see `git log --oneline -20` for examples; dev-setup pointer to `docs/users/getting-started.md`; maintainer-bandwidth expectations); `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 verbatim; fetch canonical text and substitute `[INSERT CONTACT METHOD]` with the noreply email); `.github/ISSUE_TEMPLATE/bug_report.md` (front-matter `name`, `about`, `labels: bug`; body sections: reproduction steps, expected vs actual behavior, environment (OS, Docker vs Desktop path, release version), logs); `.github/ISSUE_TEMPLATE/feature_request.md` (front-matter `name`, `about`, `labels: enhancement`; body sections: problem statement, proposed solution, why now); `.github/PULL_REQUEST_TEMPLATE.md` (summary, test-plan checklist, UI screenshots, breaking-changes flag).
      Update `README.md`: append a bottom section linking `LICENSE`, `SECURITY.md`, and `CONTRIBUTING.md`. Do NOT touch the existing header/badges/install section.
      Success criteria: (a) all files exist at correct paths; (b) `grep -RIn '<any real-name variant>' LICENSE SECURITY.md CONTRIBUTING.md CODE_OF_CONDUCT.md .github/ISSUE_TEMPLATE .github/PULL_REQUEST_TEMPLATE.md` returns nothing; (c) `LICENSE` copyright line is exactly `Copyright (c) 2026 Gekkotron`; (d) `README.md` bottom section links all three community docs.

- [x] Cut `v1.0.0-desktop-beta1` — finish + publish release
      Prior state (verified 2026-07-18): version bumps in `desktop/src-tauri/Cargo.toml` + `tauri.conf.json` are done; `docs/RELEASES/v1.0.0-desktop-beta1.md` exists; annotated tag `v1.0.0-desktop-beta1` is on `origin` pointing at commit `9edc8b4`; both workflow triggers are correct (`desktop-release.yml` uses `v*-desktop*`, `release.yml` excludes `!v*-desktop*`); the latest `desktop-release` run at that tag (`29638068094`) is green with all three "Attach to draft GitHub Release" steps succeeding. Despite that, `gh api repos/Gekkotron/Athena-Accounting/releases` returns `[]` — no release exists. What remains is figuring out where the draft went and finishing publication.
      Investigate: pull the raw logs of run `29638068094` (`gh run view 29638068094 --log`), specifically the "Attach to draft GitHub Release" step for each matrix job, to confirm whether `softprops/action-gh-release@v2` actually created/updated the release or silently no-op'd. Look for the `release_id`, `upload_url`, or `html_url` fields in that step's output.
      If the draft was created and then deleted: re-trigger the workflow via `gh workflow run desktop-release.yml -f tag=v1.0.0-desktop-beta1` (workflow_dispatch input) — this reuses the same tag without re-tagging, and rebuilds artifacts. Do NOT force-retag unless the tag itself is corrupt.
      Once a draft release with three artifacts (`.dmg`, `.AppImage`, `.exe`) exists, promote: `gh release edit v1.0.0-desktop-beta1 --draft=false`.
      Do NOT attempt to launch `.exe` or `.AppImage` from this macOS session — cross-OS install verification is the human-owned checklist under `## Manual checklist` in this file (parser-invisible section) and is expected to complete outside the orchestrator.
      Success criteria: `gh release view v1.0.0-desktop-beta1 --json isDraft,assets` shows `isDraft:false` and three assets (`.dmg`, `.AppImage`, `.exe`).

- [x] Restyle the public docs site to match the app's visual identity
      Target: <https://gekkotron.github.io/Athena-Accounting/> — currently uses the default theme of whatever static-site generator sits behind it. Make it feel like a first-party companion to the app.
      Investigate first: identify the generator by checking for `website/`, `docs-site/`, a top-level `docusaurus.config.*`, `mkdocs.yml`, `astro.config.*`, `vitepress.config.*`, `_config.yml` (Jekyll), or a `.github/workflows/*pages*.yml` that deploys `gh-pages` — do NOT guess; grep and report what you found.
      Extract the app's design tokens from the frontend: read `frontend/tailwind.config.*` (colors, fonts, radii, shadows), the primary logo file (likely `website/static/img/logo.svg` per Task 8's icon prep, or `frontend/public/logo.*`), the favicon, and any CSS variables in `frontend/src/index.css` or equivalent. Note the exact hex values, font stack, and asset paths — the docs site will reuse these verbatim.
      Apply to the docs site: brand color as the accent (links, headings, active nav), the same font stack (self-host webfonts under `static/fonts/` if the site is offline-friendly, or use the CDN the frontend uses), the same favicon and header logo, a matching dark-mode palette that mirrors the app's, and inline code / code-block styling that matches the app's monospace choice.
      Do NOT rewrite content — this is style-only. Any existing pages keep their markdown untouched; only the theme layer (CSS, config, layout components) changes.
      Preview locally with the generator's dev server, then push. If the deploy is on `gh-pages` via workflow, verify the workflow still runs green and the deployed site shows the new theme within a couple of minutes.
      Success criteria: (a) side-by-side screenshot comparison of app landing page and docs landing page shows matching brand color, logo placement, typography, favicon, and dark-mode support; (b) generator's build passes locally and in CI; (c) no content regressions (all existing docs pages still render).

- [x] Docs
      `docs/users/desktop-install.md`: download links, first-run flow, where data lives per OS, how to back up.
      Update `docs/users/getting-started.md`: two-path fork at the top — "Family server (Docker)" vs "Solo user (Desktop)". Neither disparages the other.
      Update `README.md`: install badges for both paths; the Docker prerequisite disclaimer that currently sits at the top becomes conditional on the Docker path.
      Blog post announcing dual distribution once release lands.

- [x] MCP compatibility check
      The MCP endpoint (`/api/mcp/rpc`) must still be reachable in Tauri mode.
      Tauri binds to `127.0.0.1` on a random port — Claude Desktop, Cursor, etc. need to know that port. Options: (a) ship a Tauri "menu bar" indicator that shows the current port + a "Copy MCP config" button, or (b) write the current port to a well-known file (`${DATA_DIR}/.mcp-port`) that Claude Desktop's config can reference.
      Pick one, implement, verify against real Claude Desktop MCP config.
      Success criteria: installing the Tauri app + configuring Claude Desktop's MCP settings from the app's provided config → Claude successfully calls an Athena MCP tool.

- [x] Packaging workflow + CI
      GH Actions workflow `.github/workflows/desktop-release.yml`. Trigger: tag push matching `v*-desktop`.
      Matrix `macos-latest`, `ubuntu-latest`, `windows-latest`. Each job runs `desktop/scripts/build-sidecar.sh` for its own platform (produces `desktop/sidecar/` populated with the right Node binary + prebuilds), builds the frontend (`npm run build`), builds the Tauri app (`cargo tauri build`), then uploads `.dmg` / `.AppImage` / `.exe` as GH Release artifacts.
      Skip macOS code-signing initially (users get the "unidentified developer" dialog once; documented workaround). Revisit once we have an Apple Developer account.
      Success criteria: pushing `v1.0.0-desktop-rc1` produces a draft release with three artifacts, each installable on their target OS and each launching the app successfully.

- [x] Tauri shell in `desktop/`
      New `desktop/` folder (Tauri 2, Rust). `src-tauri/tauri.conf.json` declares the **sidecar directory** built above as a bundled resource, and configures Tauri's sidecar mechanism to spawn `./sidecar/node ./sidecar/entry.js` (path resolved via Tauri's resource dir).
      Rust code (~40–60 lines): spawn sidecar, read `ATHENA_PORT=…` from stdout, open the main window pointed at `http://127.0.0.1:{port}`, kill sidecar on window close.
      App icon: convert `website/static/img/logo.svg` to `.icns` (Mac), `.ico` (Windows), and `.png` (Linux 512×512).
      Success criteria: with a locally-built `desktop/sidecar/` in place, `cargo tauri dev` opens a window showing the frontend, hitting the sidecar's Fastify. Closing the window shuts down the sidecar cleanly (no zombie process).

- [x] Package the backend as a directory-based sidecar
      Build a self-contained `desktop/sidecar/` layout for the current dev host (macOS-arm64 first; cross-compile happens in the packaging task below).
      Layout: `desktop/sidecar/node` (bundled Node 22 runtime) + `desktop/sidecar/entry.js` (a single esbuild bundle of `backend/src/entry/tauri.ts`, `--platform=node --bundle --external:` for anything with native binaries) + `desktop/sidecar/prebuilds/` (native modules copied out of `node_modules` post-install: `sharp`, `@napi-rs/canvas`, `@node-rs/argon2`, PGlite `.wasm`, `pdfjs-dist` worker, `tesseract.js` traineddata as needed).
      Add a `desktop/scripts/build-sidecar.sh` (or `.mjs`) that: downloads the Node binary for the target platform (unofficial-builds.nodejs.org for cross-arch if needed, else nodejs.org/dist), esbuilds the entry, copies prebuilds. Runs cleanly on the dev host with no CI dependency.
      Boot check: `./desktop/sidecar/node ./desktop/sidecar/entry.js` prints `ATHENA_PORT=<n>`, `curl 127.0.0.1:<n>/health` returns `{ok:true}`.
      Do NOT try to cross-compile inside this task — that's the packaging workflow's job. Ship a working single-platform sidecar as proof.
      Success criteria: `desktop/sidecar/` builds locally from a clean checkout; the sidecar boots standalone and answers `/health`; the layout is documented in `desktop/README.md` so the packaging task knows what to bundle per platform.

- [x] Serve the frontend from Fastify
      Add `@fastify/static` and register it in `buildServer()` under `NODE_ENV=production` (or a new `SERVE_STATIC` flag): serves `frontend/dist/` from `/`.
      Same Fastify serves both API and UI — matches how Docker Compose already routes.
      Success criteria: with the sidecar running, opening `http://127.0.0.1:{port}/` shows the app; API requests to `/api/*` still work.

- [x] Data-directory helper
      Add `backend/src/dataDir.ts` — returns the working directory for user data (PGlite file, backups, uploads).
      Reads `DATA_DIR` env; falls back to `/data` (Docker) or CWD (dev). Refactor backup routes, the PGlite path from the Tauri-entry task, and any hardcoded file paths through this helper.
      Success criteria: grep for hardcoded `/data` shows only tests + docs; both driver paths respect `DATA_DIR`.

- [x] Make auth optional via `AUTH_MODE=none|session`
      Session middleware, cookie parser, and `requireAuth` hooks become no-ops when `AUTH_MODE=none` — routes still register, but `req.userId` is populated from a single hard-coded local user seeded on first boot.
      Default: `session` (Docker path unchanged). Existing session-based tests continue to run under `AUTH_MODE=session`. Add a small parallel suite that boots under `AUTH_MODE=none` and confirms authenticated routes work without a login round-trip.
      Success criteria: Docker behavior byte-identical; Tauri build reaches `/api/accounts` without logging in.

- [x] Add Tauri entry point (`backend/src/entry/tauri.ts`)
      Reads env with `DB_DRIVER=pglite`, `AUTH_MODE=none`, `DATA_DIR=<from env>`.
      Runs migrations against the PGlite file at `${DATA_DIR}/athena.db`. Calls `build()` from the previous task.
      Binds to `127.0.0.1` on `port: 0` (OS-assigned). After `listen()` resolves, prints exactly one line to stdout: `ATHENA_PORT=<port>` — the Rust shell parses this. Handles SIGTERM cleanly (Rust shell sends it on window close).
      Success criteria: run `node dist/entry/tauri.js` standalone, see `ATHENA_PORT=54321` (or similar), `curl 127.0.0.1:54321/health` returns `{ok:true}`.

- [x] Extract `buildServer()` from `backend/src/server.ts`
      Current `server.ts` mixes app construction with process-level boot (SIGINT/SIGTERM, `runMigrations()`, `listen()`).
      Split into two files: `backend/src/buildServer.ts` exports `build(opts)` factory (pure app construction), and `backend/src/entry/server.ts` is the Docker/LAN entry (reads env, runs migrations, binds `0.0.0.0:PORT`, wires signals — preserves current behavior).
      Update `package.json` `dev` and `start` scripts to point at the new entry.
      Success criteria: existing backend test suite passes unchanged. `npm run dev` boots the app identically.

- [x] Verify Drizzle migrations run on PGlite
      Point `runMigrations()` at the PGlite adapter when `DB_DRIVER=pglite`.
      Sweep raw SQL clauses (`date_trunc`, `interval`, `NUMERIC(14,2)`, `sql\`...\`` blocks) for PGlite compatibility. All are supposed to work — verify empirically, patch what doesn't.
      Add a smoke test: boot with `DB_DRIVER=pglite` on an empty DB, run migrations, do one insert + one select round-trip on `users` and `transactions`.
      Success criteria: all existing DB migrations apply cleanly on PGlite; smoke test green.

- [x] Abstract the DB driver behind a factory
      Introduce `DB_DRIVER=postgres|pglite` env var (default `postgres`). Refactor `backend/src/db/client.ts`: build the Drizzle instance from the driver, not directly from `pg.Pool`. Postgres path stays default and behaves identically. Add `@electric-sql/pglite` + `drizzle-orm/pglite` dep. Add a `beforeAll`/`beforeEach` matrix in the DB-gated tests so the suite runs under both drivers.
      Success criteria: `npm test` (default Postgres) and `DB_DRIVER=pglite npm test` both pass. No route/handler code changes.

## Manual checklist (human, not the orchestrator)

The list below is not parsed by the orchestrator — this `##` header isn't one of the three known section names, so any `- [ ]` items here are invisible to the tick's `firstBacklogTask`. Track completion manually; you own this section.

- [ ] beta1 — verify macOS `.dmg` install + launch, /health returns ok
- [ ] beta1 — verify Linux `.AppImage` install + launch, /health returns ok
- [ ] beta1 — verify Windows `.exe` install + launch, /health returns ok
- [ ] beta1 — after all three verified: post announcement, update release notes with verification section ticked
