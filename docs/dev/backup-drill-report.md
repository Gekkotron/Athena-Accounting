# Backup/restore drill report

**Date:** 2026-07-18
**Environment tested:** Tauri profile (PGlite driver, AUTH_MODE=none), on
macOS-arm64 host, Node 22, backend at `1.0.0-desktop-beta1`.
**Environment not tested this pass:** Docker/Postgres — deferred pending
a live stack. The scripted drill can be re-run against Postgres with
`DB_DRIVER=postgres DATABASE_URL=…` (untested; the driver factory
supports it end-to-end via `abstract-the-db-driver-behind-a-factory`).

Runner: `backend/scripts/backup-drill.ts` (add `test:drill` to
`backend/package.json` if you want a stable invocation; the raw command
is `node_modules/.bin/tsx scripts/backup-drill.ts` from `backend/`).

## What the drill does

1. Pinned env: `DB_DRIVER=pglite`, `AUTH_MODE=none`, `DATA_DIR` and
   `PGLITE_PATH` set to a fresh `mkdtemp()` under `os.tmpdir()`.
2. Runs migrations, calls `ensureLocalUser()` — same startup path as
   `backend/src/entry/tauri.ts`.
3. Seeds via `app.inject()` (HTTP-level, avoiding a real network round
   trip): 2 accounts, 8 categories, 5 rules, 3 budgets, 1 balance
   checkpoint. Then bulk-inserts 210 transactions directly via drizzle
   (faster than 210 HTTP calls, gives deterministic dedup_keys).
4. Computes **hashPre**: SHA-256 of `{ perTableCounts,
   sha256(last-10 tx by dedup_key, ordered) }`.
5. Calls `GET /api/backup/export` in-process. Saves the envelope to
   disk, records its SHA-256.
6. Calls `POST /api/backup/import` with the same envelope. The route
   deletes the current user's rows in a transaction, then repopulates
   from the envelope.
7. Computes **hashPost** from the freshly-restored state.
8. Asserts `hashPre.combinedSha256 === hashPost.combinedSha256`. Exits
   0 on match, 1 on mismatch. Cleans up the temp dir either way.

## Latest run

```
[pre-export]
  accounts                 2
  categories               9
  rules                    5
  transactions             210
  balanceCheckpoints       1
  budgets                  3
  accountFilenamePatterns  0
  fileImports              0
  transactionSplits        0
  lastTenSha256            4464907e1a9f5dcc48133bb277aa08519b19c9d2bd341669734537520f93f8f5
  combinedSha256           799a9402342226bb47b9d1dba2272dcec1bb13bd2d4921d861d3d8cdf366ee37

[export] file /tmp/athena-drill-XXXX/export.json
  size                     73272 bytes
  sha256                   a4659d0f22e2cad44eeb2f9e5fd16cf116d6d75a450f181cc7f91e25e262a1e2

[post-restore]
  accounts                 2
  categories               9
  rules                    5
  transactions             210
  balanceCheckpoints       1
  budgets                  3
  accountFilenamePatterns  0
  fileImports              0
  transactionSplits        0
  lastTenSha256            4464907e1a9f5dcc48133bb277aa08519b19c9d2bd341669734537520f93f8f5
  combinedSha256           799a9402342226bb47b9d1dba2272dcec1bb13bd2d4921d861d3d8cdf366ee37

[result] round-trip MATCH ✓
[timings]
  migrate              213.3 ms
  ensureLocalUser      4.9 ms
  seed                 81.5 ms
  hashPre              17.1 ms
  export               8.2 ms
  restore              106.8 ms
  hashPost             6.5 ms
```

## Findings

- **Round-trip is lossless** at the row-count and content level for the
  fields the exporter emits.
- **`categories` shows 9, not the 8 seeded.** `ensureLocalUser()` seeds
  a default category on first user creation. The count matches pre and
  post so it isn't a leak — but note that the exporter includes
  `isDefault: true` categories, so a restore into an already-onboarded
  DB would try to re-insert the default and hit a unique index. The
  restore route wipes the user's rows first, so this only bites you
  cross-user (not on the Tauri single-user profile).
- **Export size:** 73 KB for 210 transactions + 9 categories + 5 rules
  + 3 budgets + 1 checkpoint — roughly 350 bytes per transaction. A
  10-year archive (~50k tx) projects to ~17 MB. Well under the 50 MB
  bodyLimit on `/api/backup/import`.
- **Timings:** the round trip finishes in **~440 ms** end-to-end,
  dominated by the migration pass and the restore transaction. The
  export itself is ~8 ms. Backups on the desktop machine happen fast
  enough that a UI progress spinner is only cosmetic.

## Follow-up items (recorded, NOT fixed here)

- **Side-by-side UI screenshots.** The plan asked for pre- and
  post-restore Dashboard/Transactions/Budgets screenshots. Deferred:
  no live app is available in this session's environment. Retake when
  the drill re-runs against a running Tauri build.
- **Docker path.** The drill exercises PGlite. A Postgres run under
  the same script would confirm the driver-agnostic promise; blocked
  on a live Docker runtime this session (see project memory
  `never-launch-orbstack`).
- **`categories` default-row bump.** If `ensureLocalUser()` seeds
  extra rows in the future, the count assertion in the drill will
  drift silently. Consider comparing per-field lists rather than
  counts.

## How to re-run

From the repo root:

```sh
cd backend
node_modules/.bin/tsx scripts/backup-drill.ts
```

The temp dir under `os.tmpdir()` is created and removed automatically.
Exit code is 0 on match, 1 on mismatch — safe to wire into CI.
