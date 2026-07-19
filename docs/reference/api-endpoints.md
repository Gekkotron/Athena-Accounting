---
title: API endpoints
sidebar_position: 3
---

# API endpoints

The REST surface the Athena frontend calls. All routes are prefixed
`/api/…` and served by the Fastify backend. See
[Architecture](../contributors/architecture.md) for the request-flow
context around this page.

Unless the "Auth" column says otherwise, every endpoint requires a
session cookie: the calling user must be logged in via
`POST /api/auth/login`. The plugin scopes every query to
`req.session.userId`, so a stolen session id from another host still
sees only its own rows.

Responses are JSON. `4xx` codes carry `{ error: "…" }` (and often
`issues: […]` for Zod parse failures); `5xx` codes carry a generic
payload plus a server-log entry.

## Auth

| Method  | Path               | Auth    | Purpose |
| ------- | ------------------ | ------- | ------- |
| `POST`  | `/api/auth/login`  | Public  | Verify username + password, regenerate the session id, set `userId` / `username` on the session. Rate-limited to 10 attempts / IP / minute. Timing-stable against a dummy hash so an unknown username can't be enumerated from response latency. Returns `{ user: { id, username } }`, `401` on invalid credentials. |
| `POST`  | `/api/auth/logout` | Session | Destroy the session cookie. |
| `GET`   | `/api/auth/me`     | Session | Returns `{ user: { id, username } }`. Used by the frontend to detect a still-live session on page load. |
| `PATCH` | `/api/auth/me`     | Session | Change `username` and/or `newPassword`. `currentPassword` is always required (a leaked session cannot quietly lock the real user out). Rate-limited 10 / IP / minute. `409` on username collision. |

## Onboarding

Two endpoints that gate the "first user" flow. Both are public.

| Method | Path                     | Auth   | Purpose |
| ------ | ------------------------ | ------ | ------- |
| `GET`  | `/api/onboarding/status` | Public | `{ needsOnboarding: boolean }` — `true` iff the `users` table is empty. |
| `POST` | `/api/onboarding/create` | Public | Register a new user (min-8 password), seed the default "Divers" category, and set the session cookie. Rate-limited 5 / IP / minute. Open by design on a LAN install — restrict via firewall or VPN if you need stricter control. `409` on username collision. |

## Accounts

Bank / brokerage / cash accounts. Every route requires a session.

| Method   | Path                             | Purpose |
| -------- | -------------------------------- | ------- |
| `GET`    | `/api/accounts`                  | List with `currentBalance`, `availableBalance` (nets out `lockYears`), and per-account transaction counts, computed in one raw-SQL pass. |
| `POST`   | `/api/accounts`                  | Create. Body: `{ name, type, currency, openingBalance, openingDate, lockYears? }`. `409` on `(user_id, name)` collision. |
| `PUT`    | `/api/accounts/order`            | Bulk reorder. Body: `{ ids: number[] }` — writes `display_order = index`. Rejects duplicate ids. Wrapped in a transaction. |
| `GET`    | `/api/accounts/:id`              | Single row. |
| `PUT`    | `/api/accounts/:id`              | Partial update of any subset of `{ name, type, currency, openingBalance, openingDate, lockYears }`. |
| `DELETE` | `/api/accounts/:id`              | `409` if the account still has transactions (FK `ON DELETE RESTRICT`). |
| `POST`   | `/api/accounts/:sourceId/merge`  | Merge `sourceId` into `targetId`. Body: `{ targetId }`. Moves transactions (deduping on FITID / date-amount-normalized-label), promotes account-level `lockYears` onto per-row overrides, collapses transfer groups now entirely on target, repoints side tables (filename patterns, checkpoints, budgets, imports, PDF templates, PDF drafts), bumps `target.openingBalance` by `source.openingBalance`, deletes the source. All in one transaction. |

### Balance checkpoints

Per-account expected-balance markers used to reconcile against
statements.

| Method   | Path                                            | Purpose |
| -------- | ----------------------------------------------- | ------- |
| `GET`    | `/api/accounts/:id/balance-checkpoints`         | List for one account, oldest first. |
| `POST`   | `/api/accounts/:id/balance-checkpoints`         | Body: `{ checkpointDate, expectedAmount, note? }`. `409` on `(account_id, checkpoint_date)` collision. |
| `PUT`    | `/api/accounts/:id/balance-checkpoints/:cpId`   | Patch `expectedAmount` and/or `note`. Date is immutable — clients delete + recreate to move a checkpoint. |
| `DELETE` | `/api/accounts/:id/balance-checkpoints/:cpId`   | `204` on success. |

### Account filename patterns

Route imports to accounts by filename glob.

| Method   | Path                                  | Purpose |
| -------- | ------------------------------------- | ------- |
| `GET`    | `/api/account-filename-patterns`      | List, highest priority first. |
| `POST`   | `/api/account-filename-patterns`      | Body: `{ pattern, accountId, priority? }`. |
| `PUT`    | `/api/account-filename-patterns/:id`  | Partial update. |
| `DELETE` | `/api/account-filename-patterns/:id`  | Remove. |

## Categories

Two-level expense / income / neutral taxonomy.

| Method   | Path                  | Purpose |
| -------- | --------------------- | ------- |
| `GET`    | `/api/categories`     | List, ordered by kind then name. |
| `POST`   | `/api/categories`     | Create. Body: `{ name, kind, color?, parentId?, isInternalTransfer? }`. A child inherits `kind` from its parent. Rejects a `parentId` that already has a parent (only 2 levels supported). |
| `PUT`    | `/api/categories/:id` | Partial update. Guards: no self-parent, cannot nest a category that already has children, `parentId` must exist and be top-level, kind changes on a parent cascade to its children. |
| `DELETE` | `/api/categories/:id` | `409` if the row is the default fallback ("Divers"). |

## Transactions

Bulk-oriented. Every mutation is scoped to the caller's `userId`.

| Method   | Path                                       | Purpose |
| -------- | ------------------------------------------ | ------- |
| `POST`   | `/api/transactions`                        | Manual creation. Body: `accountId`, `date`, `amount`, `rawLabel`, optional `categoryId` / `notes` / `lockYears`. Server derives `normalizedLabel` + `dedupKey`. If `categoryId` is omitted, the rule engine runs (same code path as at import time). `409` on identical (account, date, amount, normalized label). |
| `GET`    | `/api/transactions`                        | Paginated list. Query: `accountId`, `categoryId` (matches direct or via any split), `sourceFileId`, `fromDate`, `toDate`, `minAmount`, `maxAmount`, `amount` (sign-agnostic, progressive-widening range), `search` (accent- and case-insensitive substring across raw / normalized / memo / notes), `includeTransfers`, `sort` (`date` / `amount` / `label`), `order`, `limit ≤ 500`, `offset`. When `accountId` is set, each row carries a `runningBalance`. Every row is hydrated with its `splits[]`. |
| `GET`    | `/api/transactions/:id`                    | Single row, hydrated with splits. |
| `PATCH`  | `/api/transactions/:id`                    | Partial update of `{ accountId, date, amount, rawLabel, categoryId, notes, lockYears }`. Touching `categoryId` flips `category_source` to `manual` so the retroactive recategorizer skips it under `preserveManual: true`. Editing `amount` fails with `409` when a split ventilation exists (drop splits first). |
| `POST`   | `/api/transactions/delete-bulk`            | Body: `{ ids: number[] }` (≤ 500). Unlinks each mirror transfer leg still owned by the user, then deletes the set, in one transaction. |
| `POST`   | `/api/transactions/categorize-bulk`        | Body: `{ ids, categoryId }`. Transfer legs and split parents are silently reported under `skipped`; the rest are updated to `category_source = 'manual'`. |
| `DELETE` | `/api/transactions/:id`                    | Unlinks the mirror leg of any transfer this row belongs to before deleting. |
| `GET`    | `/api/transactions/duplicates`             | Soft-dedup groups: same `(account, date, amount)` but different `dedup_key` and at least one row still un-marked. Query: `accountId?`. |
| `POST`   | `/api/transactions/mark-not-duplicate`     | Body: `{ ids: number[] }`. Sets `not_duplicate = true` so the group vanishes from `/duplicates`. |
| `GET`    | `/api/transactions/:id/splits`             | List the splits of one parent transaction. |
| `PUT`    | `/api/transactions/:id/splits`             | Replace splits atomically. Body: `{ splits: [{ categoryId, amount, memo? }, …] }` (2–20 items). Enforces: non-zero, sign matches parent, sum equals parent, all `categoryId`s owned by caller. Rejected on internal-transfer parents. |
| `DELETE` | `/api/transactions/:id/splits`             | Drop every split under a parent. |

## Imports

OFX / QFX / CSV / PDF ingestion, plus template management for PDFs.

| Method   | Path                                     | Purpose |
| -------- | ---------------------------------------- | ------- |
| `POST`   | `/api/imports`                           | Multipart file upload. Server infers format from extension (`.ofx` / `.qfx` / `.csv` / `.pdf`). Target account: query `?accountId=…` or filename-pattern match. PDF errors: `413 pdf_too_large` (> 10 MB), `400 pdf_encrypted`, `422 template_yielded_no_rows`. On PDF may return `{ kind: 'needs_template' \| 'imported', … }` — the wizard drives the follow-up. |
| `POST`   | `/api/imports/photo`                     | Multipart photo (JPEG/HEIC/PNG) → receipt OCR. Requires `?accountId=…`. Max 25 MB. |
| `POST`   | `/api/imports/preview`                   | Same accepted formats as `/api/imports` (except PDF), but does NOT insert rows — returns what would be imported. Feeds the pre-import review dialog. |
| `POST`   | `/api/imports/pdf/templates`             | Save zones + label for a PDF draft and run the import. Body: `{ draftId, label, zones, override_rows? }`. `410 draft_expired`, `422 template_yielded_no_rows`. |
| `POST`   | `/api/imports/pdf/templates/preview`     | Try zones against a draft without saving. Returns candidate rows for the wizard. `410 draft_expired`. |
| `GET`    | `/api/imports`                           | 100 most-recent file imports, each enriched with `computedBalance` and `delta` against `statedBalance` when present. |
| `GET`    | `/api/imports/:id`                       | One import, enriched. |
| `GET`    | `/api/imports/pdf/drafts/:id`            | Draft page text-items + OCR status (the wizard uses this to render the PDF for zone selection). |
| `GET`    | `/api/imports/pdf/drafts/:id/ocr-status` | Lightweight status probe: `{ status, progress, total, error? }`. Polled while a scanned PDF is being OCR'd. |
| `PATCH`  | `/api/imports/:id`                       | Record `statedBalance` and/or `statedBalanceDate` from the printed statement so the app can compute the reconcile delta. Either field may be nulled. |
| `DELETE` | `/api/imports/:id`                       | Cascading delete: removes the `file_imports` row AND every transaction with `source_file_id` pointing at it, in one transaction. |

### PDF templates

Saved zone maps, keyed by header fingerprint + account.

| Method   | Path                     | Purpose |
| -------- | ------------------------ | ------- |
| `GET`    | `/api/pdf-templates`     | List. Zones are stripped from the payload — the frontend only needs metadata + anchor strings. |
| `PUT`    | `/api/pdf-templates/:id` | Rename or replace zones. Zones are re-validated server-side. |
| `DELETE` | `/api/pdf-templates/:id` | `204` on success. |

### Reconcile

Match a statement PDF against existing transactions without importing.

| Method | Path             | Purpose |
| ------ | ---------------- | ------- |
| `POST` | `/api/reconcile` | Body: `{ pdfBase64, accountId, fromDate?, toDate? }`. Reuses the saved PDF template (`422 needs_template` with reason `no_text_layer` / `no_template` / `template_stale` otherwise). Widens the DB fetch by ±3 days for fuzzy matching, then returns matched / missing / extra / duplicate buckets plus a French `summaryText`. |

## Rules and categorization

Rule engine that assigns categories at import time and on demand.

| Method   | Path                | Purpose |
| -------- | ------------------- | ------- |
| `GET`    | `/api/rules`        | All rules, ordered by descending priority. |
| `POST`   | `/api/rules`        | Body: `{ categoryId, keyword, signConstraint, matchMode, priority?, enabled? }`. |
| `PUT`    | `/api/rules/:id`    | Partial update. |
| `DELETE` | `/api/rules/:id`    | Remove. |
| `POST`   | `/api/recategorize` | Re-run the engine over all non-transfer history. Body: `{ preserveManual?: boolean }` (default `true` — user choices are safe). Returns update counts. |

### Transfer rules

Auto-detect internal transfers by keyword + direction.

| Method   | Path                      | Purpose |
| -------- | ------------------------- | ------- |
| `GET`    | `/api/transfer-rules`     | List. |
| `POST`   | `/api/transfer-rules`     | Body: `{ keyword, direction: 'outgoing'\|'incoming', counterpartAccountId?, enabled? }`. |
| `PUT`    | `/api/transfer-rules/:id` | Partial update. |
| `DELETE` | `/api/transfer-rules/:id` | Remove. |

### Tri (categorize queue)

Bulk-categorize the long tail of un-categorized transactions.

| Method | Path              | Purpose |
| ------ | ----------------- | ------- |
| `GET`  | `/api/tri/groups` | Groups of un-categorized (or default-bucket) transactions bundled by `normalized_label`, most-frequent first. Query: `limit`, `offset`. |
| `POST` | `/api/tri/assign` | Body: `{ groups: [{ normalizedLabel, categoryId }], createRules?: boolean }`. Only touches rows that are still "to be categorized", so a manual choice on a sibling row is never overwritten. When `createRules: true`, also inserts a `word` rule per assignment. |

## Dashboard aggregates

The four `/api/reports/…` endpoints power the Dashboard. All require
a session and exclude transfer legs (their two sides cancel and would
otherwise poison every aggregate).

| Method | Path                      | Purpose |
| ------ | ------------------------- | ------- |
| `GET`  | `/api/reports/balance`    | Total balance grouped by currency. Splits each currency total into `total`, `available` (nets `lockYears` on the account and per row), and `invested` (the subset of `available` that lives in `type = 'investment'`). Multi-currency accounts stay separate — no auto-conversion. |
| `GET`  | `/api/reports/timeseries` | Per-account cumulative balance over time. Query: `fromDate`, `toDate`, `granularity: 'day'\|'month'`. Transfer legs ARE included here — they affect per-account balances even though they're neutral overall. |
| `GET`  | `/api/reports/categories` | Spend by (category, month). The CTE virtualizes splits, so a 3-way split counts as three rows attributed to its own split categories. Query: `fromDate`, `toDate`, `accountId?`. Transfers excluded. |
| `GET`  | `/api/reports/budget`     | Planned-vs-actual per budgeted expense category, monthly or yearly. Query: `period='monthly'\|'yearly'`, `month?` (`YYYY-MM`) or `year?` (`YYYY`), `accountId?`. Per row: `spent`, `remaining`, `pct`, `over`, `projected` (linear extrapolation once ≥ 3 days have elapsed; `null` before), 6-period `history` (with `average` / `median`), `anomaly` (spent > 1σ from mean), `suggestedLimit` (nearest-round proposal when the current cap looks off). Also returns `unbudgetedCandidates`. |

## Budgets

Budget-cap mode and envelope mode. The two modes do not share tables.

### Category budgets

| Method   | Path               | Purpose |
| -------- | ------------------ | ------- |
| `GET`    | `/api/budgets`     | List. |
| `POST`   | `/api/budgets`     | Body: `{ categoryId, monthlyLimit, currency?, period?, accountId? }`. `accountId: null` (or omitted) means "global" (all accounts). `409 budget_exists` on duplicate `(user_id, category_id, period, account_id)`. |
| `PUT`    | `/api/budgets/:id` | Partial update. |
| `DELETE` | `/api/budgets/:id` | `204` on success. |

### Envelopes

Independent from `/api/budgets`. See
`docs/superpowers/specs/2026-07-16-budget-modes-design.md` for the
design rationale.

| Method   | Path                                    | Purpose |
| -------- | --------------------------------------- | ------- |
| `GET`    | `/api/envelopes/assignments`            | Assignments for `?month=YYYY-MM`. |
| `PUT`    | `/api/envelopes/assignments`            | Upsert one `(categoryId, month)` assignment. |
| `DELETE` | `/api/envelopes/assignments/:id`        | Remove one assignment. |
| `POST`   | `/api/envelopes/reallocate`             | Move money between two categories in one month. Body: `{ fromCategoryId, toCategoryId, month, amount }`. Wrapped in a transaction. |
| `GET`    | `/api/envelopes/categories`             | Per-category settings (target amount / date / kind, overspend policy). |
| `PUT`    | `/api/envelopes/categories/:categoryId` | Upsert settings for one category. |
| `DELETE` | `/api/envelopes/categories/:categoryId` | Reset to defaults. |
| `GET`    | `/api/envelopes/holds`                  | Holds within `?from=YYYY-MM&to=YYYY-MM`. |
| `PUT`    | `/api/envelopes/holds`                  | Upsert one `(month, amount)` hold. Amount `0` deletes the row. |
| `GET`    | `/api/envelopes/report`                 | Assembled month report for `?month=YYYY-MM`: pool (income cumulative, assigned cumulative, held from prior months, held for next, available) plus per-category rows (prior-month balance, this-month assignment, this-month spend, running balance, target, overspend policy, `absorbedByPool`). |

## Settings

| Method   | Path                      | Purpose |
| -------- | ------------------------- | ------- |
| `GET`    | `/api/settings`           | Load merged settings JSONB (dashboard chart scope, etc.). `dashboardChartScope` pointing to a deleted or cross-tenant account is silently coerced to `'all'`. |
| `PATCH`  | `/api/settings`           | Shallow-merge a patch into the stored JSONB — right-hand side wins per key. |
| `GET`    | `/api/settings/mcp`       | MCP token state: `{ enabled, hasToken }`. |
| `PUT`    | `/api/settings/mcp`       | Body: `{ enabled: boolean }` — toggle MCP access without regenerating the token. |
| `POST`   | `/api/settings/mcp/token` | Generate a fresh 32-byte token, derive the content key, wrap it under a `SESSION_SECRET`-derived master key, store the wrapped key, return the plaintext token ONCE. Regeneration overwrites the previous key. |
| `DELETE` | `/api/settings/mcp/token` | Clear the wrapped key (MCP calls now `401`). |

### Tips

Onboarding-tip dismissal state.

| Method | Path                  | Purpose |
| ------ | --------------------- | ------- |
| `GET`  | `/api/tips/dismissed` | `{ dismissed: { [tipId]: timestamp } }`. |
| `POST` | `/api/tips/dismiss`   | Body: `{ id }`. Upserts one entry. `204`. |
| `POST` | `/api/tips/undismiss` | Body: `{ id }`. Removes one entry. `204`. |
| `POST` | `/api/tips/reset`     | Clears all dismissals. `204`. |

## Backup

Portable JSON dump / restore.

| Method | Path                 | Purpose |
| ------ | -------------------- | ------- |
| `GET`  | `/api/backup/export` | Emits a JSON dump keyed by natural names (account / category names, no numeric ids). Multi-user safe — only the calling user's data is included. Transfer rules are intentionally omitted (superseded by category `is_internal_transfer`); older dumps still round-trip since the schema keeps the optional field. |
| `POST` | `/api/backup/import` | REPLACE semantics, scoped to the caller. Wipes only this user's rows (in reverse dependency order) and reinserts every row from the dump under the caller's `user_id`. Body limit 50 MB. |

## MCP

Encrypted RPC surface for the Athena MCP server (Claude / IDE agents).
The only route that does not use the session cookie — it performs its
own crypto auth.

| Method | Path           | Auth   | Purpose |
| ------ | -------------- | ------ | ------- |
| `POST` | `/api/mcp/rpc` | Public | Envelope: `{ user, v: 1, nonce, ct }`. Server looks up the user, unwraps the content key (via the `SESSION_SECRET`-derived master key), decrypts the ciphertext, validates the timestamp against a ±2-minute skew, dispatches to a whitelisted op (`list_accounts`, `list_categories`, `search_transactions`, `create_transaction`, `update_transaction`, `delete_transaction`, `reconcile_statement`), then returns the response encrypted under the same key. Every op is fulfilled by injecting an internal request against the corresponding REST route with the caller's `userId` stamped by the internal-auth header. Rate-limited 60 / IP / minute. |

*See also:* [Architecture](../contributors/architecture.md)

← [Back to reference index](README.md)
