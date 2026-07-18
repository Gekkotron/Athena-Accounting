---
title: Database
sidebar_position: 4
---

# Database

This page is for people modifying the schema. If you only want to query
the DB, the Drizzle types in `backend/src/db/schema.ts` are
self-documenting.

For the higher-level context (how the backend, database, and other
containers fit together), see [Architecture](architecture.md).

## PostgreSQL extensions

Athena requires three extensions. Each is loaded in the very first
migration (`0000_init.sql`) and must exist on the Postgres image
Compose uses (the stock `postgres:16` image ships all three).

### `pg_trgm` — trigram-indexed full-text search

The Tri tab groups uncategorised transactions by *similar label*, and
the rule engine matches keywords against every label the user has ever
imported. Both are hot paths over the full `transactions` table.

We keep two indexes on `transactions.normalized_label`:

- a plain B-tree on `immutable_unaccent(lower(normalized_label))` for
  exact accent- and case-insensitive lookups (rule matching);
- a GIN index using `gin_trgm_ops` for trigram similarity — this is
  what powers the "same-label" grouping in Tri and the fuzzy suggest
  when creating a rule from a transaction.

Without `pg_trgm`, the GIN index cannot be created and the Tri tab
degrades to a full sequential scan on every keystroke.

### `unaccent` — accent folding

French labels routinely mix accented and unaccented spellings for the
same merchant (`AMÉLIE`, `AMELIE`, `amélie`). We normalise at import
time (`normalized_label` is written accent-folded and lower-cased) so
lookups don't have to do the work, but two places still need `unaccent`
at query time: rule matching against `keyword`, and the trigram search
above.

Postgres marks `unaccent(...)` as `STABLE` by default, which forbids
using it in an index expression. `0000_init.sql` therefore defines an
`IMMUTABLE` SQL wrapper — `immutable_unaccent(text)` — and every
functional index calls that wrapper instead of the raw function.

### `pgcrypto` — UUIDs (and defense in depth)

`transactions.transfer_group_id` is a UUID that links the two legs of
an internal transfer. Rows are minted server-side with
`gen_random_uuid()`, which `pgcrypto` provides. That's the single
runtime dependency inside the SQL layer.

The MCP token wrapping itself happens in Node (`AES-256-GCM` via
`node:crypto`, see `backend/src/domain/mcp/crypto.ts`) — Postgres only
stores the resulting base64 blob in `user_settings.mcp_key_wrapped`.
The extension is still loaded because `gen_random_uuid()` is only
available when `pgcrypto` is installed, and because future migrations
that want per-column encryption (`pgp_sym_encrypt` / `pgp_sym_decrypt`)
should not need a fresh migration to enable the extension first.

## Key tables and invariants

Full column-level definitions live in `backend/src/db/schema.ts`. The
list below is a map of the invariants the application relies on — the
things you will break if you skip them in a new migration.

### `users`

Single row per local account. `password_hash` is argon2id output; the
Fastify auth plugin never reads the raw password. Cascade delete
removes every row this user owns across the schema — the
per-table `user_id` columns exist explicitly to make GDPR-style
deletion one statement.

### `accounts`

`(user_id, name)` is unique. Every reported balance is computed as
`opening_balance + SUM(amount WHERE date >= opening_date)`, so those
two columns are mandatory. `currency` is per-account (no FX table yet).
`lock_years`, if set, marks funds as "blocked" until
`opening_date + lock_years` — this is the source of the
"Disponible / Bloqué" split on the Dashboard.

### `transactions`

One row per leg. An internal transfer is two rows linked by
`transfer_group_id`; aggregates that report expense/income exclude
those rows with `WHERE transfer_group_id IS NULL`.

Idempotent re-imports rely on `UNIQUE(account_id, dedup_key)`.
`dedup_key` is the OFX `FITID` when the source file provides one, else
`sha1(account|date|amount|normalized_label)`.

`raw_label` is the string the bank shipped; `normalized_label` is the
accent-folded, lower-cased version used by rules and full-text search.
The two full-text indexes described under `pg_trgm` above sit on
`normalized_label`.

`category_source` records how the current category was set (`manual`,
`auto`, `default`, `llm`). The retroactive re-categorization pass
respects `preserveManual: true` by refusing to touch rows where
`category_source = 'manual'`.

### `rules` and `transfer_rules`

`rules` assign a category when a keyword matches
`immutable_unaccent(lower(normalized_label))`. `sign_constraint`
prevents an "expense" rule from firing on a positive amount.
`match_mode` chooses between word-boundary, substring, and regex
matching; `'word'` is the default and stops `"paye"` from matching
`"payweb"`.

`transfer_rules` do not assign a category. They flag a transaction as
one leg of an internal transfer and link it to its mirror leg via
`transfer_group_id`.

### `category_budgets`, `envelope_assignments`, `envelope_category_settings`, `envelope_month_holds`

Two mutually-exclusive budget models coexist:

- **Plafonds mode** — `category_budgets` holds one recurring cap per
  `(user, category, period)` optionally scoped to a single account.
  Uniqueness is enforced by two partial indexes: one on
  `(user_id, category_id, period) WHERE account_id IS NULL` (global)
  and one on `(user_id, category_id, period, account_id) WHERE account_id IS NOT NULL` (scoped).
- **Enveloppe mode** — `envelope_assignments` allocates a per-month
  amount per category (unique on `(user, category, month)`).
  `envelope_category_settings` stores optional targets and
  overspend policy. `envelope_month_holds` implements the "reserve
  for next month" buffer.

### `balance_checkpoints`

Manual reconciliation markers per account. Unique on
`(account_id, checkpoint_date)`. Displayed as diamonds on the Dashboard
trend chart; when the computed cumulative balance drifts from
`expected_amount`, the diamond renders in amber.

### `file_imports`

Audit row per uploaded file: `total_lines`, `inserted_count`,
`dedup_skipped`, and optionally the `stated_balance` printed on the
statement. Re-uploading the same file produces a fresh row with
`inserted_count = 0` and `dedup_skipped = total_lines` — the UI reads
this to explain "0 new rows because everything was already there".

### `transaction_splits`

Ventilation of one transaction across N ≥ 2 categories. Owned by its
parent transactively via `transaction_id`; a `user_id` column would be
redundant. Two invariants, enforced by triggers — see
[Deferrable triggers](#deferrable-triggers-for-transaction-splits)
below.

### `user_settings`

One row per user, primary-keyed by `user_id`. The `settings` column is
a JSONB blob shaped by the Zod schema at
`backend/src/domain/settings/schema.ts` — adding a new preference is a
Zod change, not a migration. `mcp_enabled` and `mcp_key_wrapped` store
the MCP endpoint's opt-in flag and the wrapped content key (see
`pgcrypto` above).

## Migrations — authoring and applying

Migrations are plain SQL files under `backend/src/db/migrations/`,
numbered `NNNN_short_slug.sql`. `runMigrations()` in
`backend/src/db/migrate.ts` applies them at server boot:

1. Ensures a `schema_migrations(filename, applied_at)` table exists.
2. Lists every `*.sql` file in the migrations directory and sorts
   lexicographically. **Order is by filename, not by mtime** — always
   pick the next `NNNN` prefix so a fresh checkout applies files in
   the same order as your local DB.
3. Skips files already present in `schema_migrations`.
4. Wraps each file in `BEGIN … COMMIT`; a mid-file failure rolls back
   cleanly and leaves `schema_migrations` untouched, so the next boot
   retries.
5. Runs raw SQL via the driver's `.exec()` so multi-statement bodies
   work under both drivers (`pg` on the Docker path,
   `@electric-sql/pglite` on the Tauri path — see
   [Architecture](architecture.md) for the driver-factory split).

Practical conventions:

- One transaction per file. Don't put your own `BEGIN/COMMIT` inside
  the migration — the runner already does it.
- Keep the file idempotent-ish where it costs nothing (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), but the runner already
  skips applied files, so this is belt-and-braces.
- Keep `backend/src/db/schema.ts` in sync in the same commit. The
  Drizzle types are the API layer's source of truth; drift between
  the two shows up as runtime errors.
- Prefer plain SQL over Drizzle Kit generation. Every migration in
  this tree is hand-written.

## Deferrable triggers for transaction splits

Migration `0014_transaction_splits.sql` installs two triggers to keep
the ventilation invariants honest at the DB layer.

**Checksum trigger** — after any `INSERT/UPDATE/DELETE` on
`transaction_splits`, `SUM(amount)` for the affected parent must equal
either `parent.amount` (fully split) or `0` (not split — the parent's
own `category_id` is authoritative).

The trigger is `DEFERRABLE INITIALLY DEFERRED`. That matters because a
common edit — "replace all splits with a new set" — is naturally a
`DELETE` + N `INSERT`s inside one transaction. During intermediate
statements the sum is nonsense; only the final commit-time state has
to hold the invariant.

**Amount-lock trigger** — `BEFORE UPDATE ON transactions` refuses to
change `amount` while any splits exist for that transaction. Without
it, editing the parent silently invalidates the split checksum. The
UI removes the amount input when splits are present, so this trigger
is defense-in-depth against direct API calls.

## Running balance

There is no persisted `running_balance` column. The `transactions`
list endpoint (`GET /api/transactions`) computes it at query time,
under one specific condition: the request is scoped to a single
account (`accountId` in the query string).

The computation lives in `backend/src/http/routes/transactions/index.ts`:

1. Look up the scoped account's `opening_balance` and `opening_date`.
2. Select the full ordered history for that account
   (`date >= opening_date`, sorted by `(date, id)`).
3. Fold `amount` into a `Map<txId, string>` keyed by transaction id.
4. Attach `runningBalance` to each response row via the map.

Two reasons for the design:

- **Consistency with `currentBalance`.** The Accounts page renders
  `opening_balance + SUM(amount WHERE date >= opening_date)`. The
  running balance uses the same basis, so the last visible row on the
  transactions table always reconciles with the account card.
- **Pagination / sort / filter stability.** Because the map is keyed
  by transaction id and computed over the *full* history, changing the
  page, sort, or filters never distorts an individual row's value.

Rows dated before `opening_date` receive no entry and render as `—` in
the UI, mirroring how `currentBalance` excludes them.

## See also

- [Architecture](architecture.md) — the higher-level container and
  request-flow picture.
- [Code map](code-map.md) — where the DB code lives in the tree
  (`backend/src/db/`).
- [Development](development.md) — running Postgres and PGlite locally.

← [Back to contributor docs](README.md)
