---
title: Backup and recovery
sidebar_position: 8
---

# Backup and recovery

Athena keeps all your data local — on your home server (Docker) or in the desktop app's PGlite file. Backing up is simply producing a portable JSON file that you file away wherever you like; restoring is feeding it back into a fresh or existing install.

:::caution Known limitation
Export files are **plain JSON, with no encryption at rest**. They contain the full set of your accounts, transactions, rules and budgets. Keep them in an encrypted folder (FileVault, BitLocker, LUKS, Cryptomator, etc.) or in password-protected storage if you keep them off the origin machine.
:::

## Where is the database?

- **Desktop app (Tauri).** The PGlite file `athena.db` lives in `$DATA_DIR`, which defaults to:
  - macOS: `~/Library/Application Support/Athena Accounting/`
  - Linux: `~/.local/share/Athena Accounting/`
  - Windows: `%APPDATA%\Athena Accounting\`
  (Athena creates the folder on first launch.)
- **Home server (Docker).** The named volume `athena_pgdata` is mounted at `/var/lib/postgresql/data` in the Postgres container. Backing up the raw volume is possible, but the JSON export described below is more portable — it works across versions and restores just as well onto the desktop app as onto Docker.

## Export (via the UI)

1. Open **Settings → Data → Backup**.
2. Click **Export data**. Athena downloads a file named `athena-backup-YYYY-MM-DD-HHMMSS.json`.
3. File it into encrypted storage (see the limitation above).

There's nothing to configure server-side: the export is a plain `GET /api/backup/export` that serialises your user with every relation, using natural keys (account names, category names), so it stays readable outside Athena too.

## Schedule regular exports

Athena doesn't schedule automatic exports — this is deliberate, to avoid the file landing somewhere you don't control. Two common approaches:

- **macOS/Linux (cron).** A weekly `curl` script that calls the endpoint and drops the result into an encrypted folder:
  ```sh
  curl -s -o "/mnt/vault/athena-$(date +%F).json" \
    -b athena_session=… \
    http://home.lan:8000/api/backup/export
  ```
  The session cookie comes from a prior login; on desktop (Tauri, `AUTH_MODE=none`) the cookie isn't required.
- **Windows (Task Scheduler).** Same idea, with `Invoke-WebRequest` in a PowerShell script.

## Restore (via the UI)

1. **Back up first.** A restore overwrites all data for the current user. Take an export of the present before you go.
2. Open **Settings → Data → Backup**, *Restore* section.
3. Pick your `.json` file. Athena will:
   - check that the format version is one it knows (v1 to v4 today);
   - delete the current user's rows (in a transaction);
   - re-inject accounts, categories, rules, budgets, checkpoints, imports and transactions.
4. The page redirects to the dashboard. Verify that the balances, budgets and rules match what you expected.

Because the file is portable, the same procedure works to migrate from a Docker server to the desktop app (or the other way round).

## What if the PGlite file is corrupted?

1. Close the app.
2. Rename `$DATA_DIR/athena.db` to `athena.db.corrupt` (don't delete it — just in case).
3. Relaunch the app: Athena creates an empty database and shows onboarding.
4. Go through **Restore** with your latest export.

If you don't have a recent export, `athena.db.corrupt` can sometimes be read by `sqlite3` or `pglite` with `PRAGMA integrity_check` and then recovered manually — this is a technical operation, not consumer-grade.

## Common pitfalls

- **Multiple tabs.** Don't restore from several tabs at the same time — the restore takes a transactional lock, but two clients downloading and then re-uploading the same file can produce duplicate import records if one finishes after the other.
- **Wrong user (Docker).** On the home server, every user has their own dataset. A restore overwrites **only** the logged-in user's rows; other household members are untouched. Double-check that you're signed in on the right account before restoring.
- **Format versions.** Athena rejects files whose `version` is higher than what it knows. Downgrade ⇒ immediate failure, no partial restore.

## Proof of correctness

The script `backend/scripts/backup-drill.ts` runs a round-trip on a temporary PGlite database (210 transactions, 2 accounts, 8 categories, 5 rules, 3 budgets, 1 checkpoint), hashes the state before exporting, restores the downloaded file, then re-hashes. The two fingerprints must match. The report from the latest run lives in [`docs/dev/backup-drill-report.md`](https://github.com/Gekkotron/Athena-Accounting/blob/main/docs/dev/backup-drill-report.md).

## See also

- [Getting started](./getting-started)
- [Security and privacy](./security-and-privacy)
