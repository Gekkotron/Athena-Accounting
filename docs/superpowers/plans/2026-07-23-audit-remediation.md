# Project audit — remediation plan (2026-07-23)

Full-project audit (security, backend correctness, frontend, architecture) run by
four parallel review agents; the three critical findings below were re-verified
by hand against the code. Tasks are ordered by severity. Each task is written to
be self-contained so it can be promoted into `PLAN.md`'s `## Backlog` (remember
the format contract: one paragraph body, no blank lines, no nested bullets).

Overall: the codebase is healthy — parameterized SQL everywhere, argon2id auth,
integer-cents money math in the core paths, pervasive zod validation, no
committed secrets, no XSS surface. The findings below are the exceptions.

---

## P0 — Critical (fix before anything else)

### 1. `rules.ts` routes are missing the `userId` scope (IDOR)
- **Files:** `backend/src/http/routes/rules.ts:38-44` (GET list), `:66-83` (PUT), `:85-94` (DELETE)
- **Issue:** `GET /api/rules` selects with no `userId` filter; `PUT`/`DELETE /api/rules/:id` filter by `id` only. Every sibling CRUD route (`transfer-rules`, `categories`, `budgets`, `accounts/crud`, `pdf-templates`, `balance-checkpoints`) correctly scopes with `and(eq(<table>.id, id), eq(<table>.userId, uid))` — `rules.ts` is the sole exception.
- **Impact:** Any authenticated user (registration is open by design) can read every user's categorization keywords and silently modify or delete other users' rules by iterating sequential integer IDs.
- **Fix:** Add `eq(rules.userId, uid)` to the WHERE clause of GET/PUT/DELETE. Add a regression test asserting a cross-user PUT/DELETE returns 404.
- **Verified:** yes — read the file directly.

### 2. Account merge silently drops transactions from balances when opening dates differ
- **Files:** `backend/src/http/routes/accounts/merge.ts:194-203` (Step F); premise in `backend/src/http/routes/reports/balance.ts:29,42` and `backend/src/http/routes/accounts/list.ts:51,64,79` (`t.date >= a.opening_date` filters)
- **Issue:** Merge moves source transactions to the target and adds source `opening_balance` to the target, but never adjusts the target's `opening_date`. Moved transactions dated before the target's `opening_date` are excluded by every balance/running-balance/timeseries query afterwards.
- **Impact:** Post-merge totals are silently wrong (short by the sum of the gap-dated transactions). No error, no log. `tests/accounts-merge.test.ts` only ever uses identical opening dates, so the path is untested.
- **Fix:** In the merge transaction, set `target.opening_date = LEAST(source.opening_date, target.opening_date)` and reconcile `opening_balance` accordingly (source's opening balance belongs at source's opening date), or reject merges with differing opening dates with a clear 409. Add tests with differing opening dates and a transaction in the gap.
- **Verified:** yes — read merge.ts Step F and confirmed the `>= opening_date` filters.

### 3. CSV import corrupts period-decimal amounts 100× in the comma-delimited fallback
- **Files:** `backend/src/domain/imports/french-numerics.ts:16-24` (`parseFrenchAmount`), `backend/src/domain/imports/csv-parser.ts:67-75,106-114` (comma-delimited fallback)
- **Issue:** `parseFrenchAmount` strips every `.` as a thousands separator. The comma-delimited fallback path exists precisely for files whose amounts use `.` as the decimal point, yet it still routes amounts through `parseFrenchAmount`: `"-950.00"` → `"-95000.00"`.
- **Impact:** A `Date,Libellé,Montant` CSV with `-950.00` imports as −95 000,00 € with no error. The test suite's own comment (`backend/tests/domain/csv-parser.test.ts:47-56`) acknowledges the ambiguity but only tests whole numbers.
- **Fix:** In the comma-delimited branch, parse amounts with period-decimal rules — or per-value detection: exactly one `.`, no `,`, 1–2 trailing digits ⇒ decimal point. Add tests for `-950.00`, `1,234.56`, `42`, and French `950,00` in the semicolon path.
- **Verified:** yes — read `parseFrenchAmount`; the strip-then-convert behavior is exactly as described.

---

## P1 — High

### 4. Checkpoint/opening-balance inputs bypass `parseDecimal` (French comma rejected)
- **Files:** `frontend/src/pages/Accounts/BalanceCheckpointsDrawer.tsx:88`, `frontend/src/pages/Accounts/CheckpointRow.tsx:29`, `frontend/src/pages/Accounts/AccountForm.tsx` (openingBalance, used in `frontend/src/pages/Accounts/index.tsx:190`)
- **Issue:** These three money inputs send the raw typed string to the API; the backend zod schema only accepts `^-?\d+(\.\d{1,2})?$`. Typing "1500,00" (the natural French format, accepted everywhere else via `parseDecimal`) gets a 400.
- **Fix:** Run the values through `parseDecimal` before building the payload, blocking submit on `null` (mirror `AssignmentInput.commit()` / `AddBudgetForm.normalizeLimit`). Add a comma-value test to `AccountForm.test.tsx`.

### 5. Partial-failure in transaction create/edit with splits can duplicate transactions
- **Files:** `frontend/src/pages/Transactions/TransactionModal.tsx:151-185` (`persistSplits` after POST/PATCH)
- **Issue:** If the parent POST succeeds but the follow-up splits PUT fails, `onError` shows a generic error without invalidating the cache; the modal stays open and re-clicking "Créer" creates a second transaction server-side.
- **Fix:** On `persistSplits` failure after a successful create, still `invalidate()` and show "transaction created, splits failed — edit to retry"; switch the modal to edit mode on the created id (or disable re-create) so resubmission can't duplicate.

### 6. Single-transaction delete is not transactional
- **Files:** `backend/src/http/routes/transactions/delete.ts:12-34`
- **Issue:** The transfer-leg unlink (`UPDATE ... SET transfer_group_id = NULL`) and the `DELETE` run as two separate statements; a crash between them leaves the mirror leg permanently unlinked while the row survives. `bulk.ts:26-55` already wraps the same sequence in `db.transaction`.
- **Fix:** Wrap both statements in `db.transaction`, mirroring `bulk.ts`.

### 7. docker-compose binds to all interfaces while `.env.example` claims loopback-only
- **Files:** `docker-compose.yml:34-38,45-49` vs `.env.example:14-16`
- **Issue:** Port mappings omit a host IP (⇒ `0.0.0.0`); `.env.example` tells users the services "bind to 127.0.0.1 only". Contradictory docs on the security boundary, about to ship as a public template.
- **Fix:** Pick one truth: bind `127.0.0.1:` in compose and document a reverse proxy for LAN access, or fix the `.env.example` comment to describe LAN-wide exposure. Pair with a README/SECURITY.md note that open registration + LAN exposure means anyone on the network can create an account (`backend/src/http/routes/onboarding.ts:33-39`).

---

## P2 — Medium

### 8. ReDoS via user-supplied regex rules
- **Files:** `backend/src/domain/rules/matcher.ts:53`, `backend/src/domain/rules/recategorize.ts:41-101`
- **Issue:** `matchMode: 'regex'` compiles user input via `new RegExp(...)` with no complexity limit; `POST /api/recategorize` runs every rule against every transaction on the event loop. A catastrophic-backtracking pattern hangs the instance for all users.
- **Fix:** Validate patterns at rule-creation time (e.g. a safe-regex check / length cap), or run matching with a timeout.

### 9. `/metrics` is unauthenticated
- **Files:** `backend/src/http/plugins/metrics.ts:141-146`, `backend/src/buildServer.ts:56`
- **Issue:** Registered before the auth plugin; exposes cross-user aggregate counts and backup timestamps to any network client (see #7 for reachability).
- **Fix:** Gate behind `requireAuth` or a metrics bearer token / IP allowlist.

### 10. Envelope reallocation has a select-then-insert race
- **Files:** `backend/src/http/routes/envelopes/reallocate.ts:34-68` (`bumpBy`)
- **Issue:** Concurrent reallocations to a not-yet-existing `(userId, categoryId, month)` row both INSERT; the loser hits the unique index (`23505`) → unhandled 500, potentially with the from/to halves inconsistently applied.
- **Fix:** Use `onConflictDoUpdate` with `sql\`amount + excluded.amount\`` (pattern already used in `assignments.ts:50-51`).

### 11. Containers run as root; no security headers
- **Files:** `backend/Dockerfile:24-34`, `frontend/Dockerfile`, `frontend/nginx.conf`
- **Issue:** No `USER` directive in either production stage; no `X-Frame-Options`/`X-Content-Type-Options`/CSP anywhere (clickjacking possible against a logged-in user).
- **Fix:** Add `USER node` (or a dedicated user) to both Dockerfiles; add `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`, and `frame-ancestors 'none'` CSP to nginx.conf.

### 12. Global Fastify error handler + shared validation helpers (de-duplication)
- **Files:** `backend/src/buildServer.ts` (no `setErrorHandler`); `isPgError` copy-pasted in 13 route files; the zod `safeParse` + 400 block repeated 33×; `parseId` redefined in 8 files
- **Issue:** No global error mapping (uncaught throws → default 500), and heavy HTTP-layer boilerplate.
- **Fix:** One `app.setErrorHandler` mapping ZodError→400, pg `23503`/`23505`→400/409, `HttpError`→status; extract `parseId`/`IdParam`/a `validate(schema, body)` helper into `backend/src/lib/http.ts`; delete the 13 `isPgError` copies. Do this before #1's sibling cleanups touch the same files.

### 13. Frontend `api/types.ts` hand-duplicates the backend contract
- **Files:** `frontend/src/api/types.ts` vs `backend/src/db/schema.ts` + route zod schemas
- **Issue:** Two independent definitions of the API contract with no compile-time link — schema renames drift silently.
- **Fix:** Export shared zod schemas from one place (e.g. `backend/src/contracts/` or a small `shared/` dir) and derive both sides via `z.infer`; or generate `types.ts` from drizzle `$inferSelect`.

### 14. Timeseries report returns the opening-balance point outside the requested range
- **Files:** `backend/src/http/routes/reports/timeseries.ts:42-53`
- **Issue:** The `opening` CTE row isn't clipped to `[fromDate, toDate]`, so charts can receive an out-of-range bucket (e.g. 2020 point for a 2026 window).
- **Fix:** Compute the cumulative sum first, then filter `bucket >= fromDate` in the outer SELECT (or document the baseline point as intentional and handle it in the chart).

---

## P3 — Low / polish

### 15. i18n and formatting stragglers
- `frontend/src/api/errorMessage.ts:64` — hardcoded French demo-unavailable string bypasses `t()`; add `errors.demoUnavailable` to fr+en locales.
- `frontend/src/pages/Budgets/Enveloppes/Enveloppes.tsx:192-195` — `formatSignedAbs` hand-rolls `toFixed(2).replace('.', ',') + ' €'`; replace with the shared `formatAmount` (locale + thousands separator + real currency).

### 16. Budget report month-selection mixes local and UTC time
- **Files:** `backend/src/http/routes/reports/budget.ts:30-35` vs `backend/src/http/routes/reports/period-math.ts:8-15`
- **Issue:** Default month uses server-local components while `elapsedIn` uses UTC; for 1–2 h after local midnight on the 1st, the new month reports `elapsedDays = 0`.
- **Fix:** Derive the default month from UTC components too.

### 17. Schema drift: `transactionSplits.transactionId` lacks `.references()` in Drizzle
- **Files:** `backend/src/db/schema.ts:569-585` vs `migrations/0014_transaction_splits.sql:7-8`
- **Fix:** Add `.references(() => transactions.id, { onDelete: 'cascade' })` to match the live constraint.

### 18. Public-repo polish
- Move `PLAN.md` (71 KB), `TODO.md`, `STATUS.md` out of the root (e.g. `docs/internal/` or gitignore) and trim orchestrator internals from `CLAUDE.md` before the repo goes public.
- Document (or fail closed on) tesseract.js's silent CDN fetch when `OCR_LANG_PATH` is unset (`backend/src/domain/imports/ocr/index.ts:33-40`) — it contradicts the offline-privacy positioning.
- Grow the pure-unit test tier for `lib/`, `services/`, `domain/*-core` so the local pre-push `vitest run` gates more than it does today (~34 of 68 backend test files skip without `RUN_DB_TESTS=1`).
- Split oversized files opportunistically when touched: `frontend/src/pages/Transactions/index.tsx` (514 L), `backend/src/http/routes/imports.ts` (325 L — move `computedBalanceAt`/`enrichImport` into `domain/`), `backend/src/http/routes/reports/budget.ts` (310 L).
- Drop deprecated `@types/form-data`; extract the duplicated `!res.ok` handling shared by `api()`/`apiUpload()` in `frontend/src/api/client.ts`.

---

## Verified strengths (leave alone)
- Parameterized SQL throughout (only two `sql.raw` uses, both non-user-controlled).
- argon2id + timing-safe login, session regeneration, httpOnly cookies, no tokens in localStorage.
- Integer-cents money math in running-balance/splits/envelope paths, with a DB trigger backstop on split sums.
- Import pipeline: single transaction + DB-unique-constraint dedup (race-safe).
- No committed secrets; `.env`, traineddata binaries, `graphify-out/` all untracked.
- Central `frontend/src/api/client.ts`, pervasive zod validation, `parseDecimal` discipline everywhere except task #4.
