---
title: Backup and recovery
sidebar_position: 8
---

# Backup and recovery

Athena keeps all your data local — on your home server (Docker) or in the desktop app's PGlite file. Backing up is simply producing a portable JSON file that you file away wherever you like; restoring is feeding it back into a fresh or existing install.

:::caution Know what your export contains
Export files contain the full set of your accounts, transactions, rules and budgets. Every export is **always encrypted** — you set a passphrase in the **Export data** dialog, and the file is sealed with AES-256-GCM (scrypt-derived key); there's no plain-JSON option any more. Restoring prompts for that same passphrase; there is **no recovery** if you lose it, so treat it like a password-manager master password — and keep it safe independently of any encryption-at-rest password on the app itself, since the two are unrelated and losing both leaves nothing to recover.
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
2. Click **Export data**, enter a passphrase when prompted. Athena downloads a file named `athena-backup-YYYY-MM-DD-HHMMSS.enc.json`.
3. Keep that passphrase somewhere safe — it's the only way to open the file later.

Under the hood: export is a `POST /api/backup/export` with the passphrase in the request body (never a query string, so it never lands in access logs or browser history), which serialises your user with every relation using natural keys (account names, category names) and then seals the result. The plain `GET /api/backup/export` this used to be now returns `410 Gone`.

**Transaction attachments are backed up separately** through their own encrypted archive channel — see [Attachments](./attachments.md). The JSON dump above stays lean (structure + metadata only) so a heavy receipt library never inflates every backup; scheduled runs re-upload the attachment archive only when it actually changed.

## Remote backups (scheduled)

Athena can push an encrypted backup to a remote destination **automatically, once a night**, from **Settings → Data → Backup**, *Remote backup* card. Every pushed file is the same always-encrypted `.enc.json` envelope as a manual export — the passphrase you configure on the card seals each dump, and there is **no recovery** if you lose it.

Files are named `athena-backup-YYYY-MM-DD-HHMMSS.enc.json`. Retention keeps the newest N files (*Backups to keep*, default 30); pruning only ever touches files matching that exact name pattern, so anything else living in the same folder is never deleted.

One destination per user. Saving the card performs a **real test write** against the destination before storing anything — a typo'd URL, a wrong password, or an unmounted folder is rejected immediately with the underlying error. When editing an already-configured destination, leaving the password and passphrase fields blank keeps the stored ones (they are never displayed back).

### WebDAV destination

Works with any WebDAV server. Common homes for it:

- **Synology** — install the *WebDAV Server* package; the share is exposed on port 5005 (http) or 5006 (https).
- **Nextcloud** — use the files DAV endpoint: `https://your-nextcloud/remote.php/dav/files/USERNAME/`.

The optional *Subfolder* keeps Athena's files in their own directory (created automatically on first push). With a plain-`http` URL the WebDAV **password** travels unencrypted on your LAN — acceptable on a trusted home network, but worth knowing; the backup **contents** are always encrypted either way.

The **Freebox has no WebDAV server** (its disk only speaks FTP/SMB/AFP —
WebDAV is a [long-open feature request](https://dev.freebox.fr/bugs/task/37418)).
To back up onto a Freebox disk, use the FTP destination below — or the
folder destination over an SMB mount.

### FTP destination

Plain FTP in passive mode — made for the Freebox, works with any FTP
server on the LAN:

- **Freebox** — enable FTP in Freebox OS (Paramètres de la Freebox → Mode
  avancé → **FTP**) and set the password there. Server:
  `mafreebox.freebox.fr`, port `21`, user `freebox`. The optional
  *Subfolder* keeps Athena's files in their own directory (created
  automatically on first push).

FTP sends the **password** unencrypted on your LAN (there is no FTPS
support) — same trade-off as plain-http WebDAV, acceptable on a trusted
home network. The backup **contents** are always encrypted regardless.
Files are written under a temporary name and renamed once complete, so a
dropped connection never leaves a truncated backup behind.

### Folder destination

An absolute path on the machine running the backend: an SMB/NFS mount, an external disk, a synced folder. The folder must already exist — Athena deliberately refuses to create it, so a missing network mount fails loudly instead of silently writing to a local stub. In Docker, mount the target into the backend container and point the path at the mount.

**Freebox example** — enable *Partages Windows* in Freebox OS (Paramètres → Mode avancé), mount the share on the host (share name is typically `Disque dur`; `smbclient -L mafreebox.freebox.fr -N` lists it), e.g. in `/etc/fstab`:

```
//mafreebox.freebox.fr/Disque\040dur  /mnt/freebox  cifs  credentials=/etc/freebox-smb.cred,vers=3.0,iocharset=utf8,_netdev,x-systemd.automount  0  0
```

then bind-mount a subfolder into the backend container (`/mnt/freebox/athena-backups:/backups`) and use `/backups` as the folder path.

Want an off-site copy without giving Athena cloud credentials? Point the folder destination at a directory that `rclone`, Syncthing, or your NAS's own cloud tooling replicates.

### Schedule, retention and status

- The backup hour (server local time, default 03:00) is picked on the card; the scheduler checks every 15 minutes and runs **at most one backup per user per day**.
- A failed run (destination down, mount missing) is retried on the next 15-minute tick until one succeeds; the card shows the last error.
- The card's status line shows the last successful push and the next scheduled one.
- `BACKUP_AUTO=0` disables the scheduler entirely ([configuration reference](../reference/configuration.md)); the *Back up now* button still works.

### Restoring from a remote copy

Download the `.enc.json` file from your destination (any WebDAV client or file browser), then follow the normal [Restore](#restore-via-the-ui) flow — it prompts for the same passphrase the card stores. Test this once after setting up: a backup you've never restored is a hope, not a backup.

## Schedule regular exports (DIY alternative)

Prefer the built-in remote backups above. If you want full control over transport and destination, a scripted export still works:

- **macOS/Linux (cron).** A weekly `curl` script that POSTs a passphrase and drops the result into a folder:
  ```sh
  curl -s -o "/mnt/vault/athena-$(date +%F).enc.json" \
    -b athena_session=… \
    -X POST -H 'Content-Type: application/json' \
    -d '{"passphrase":"…"}' \
    http://home.lan:8000/api/backup/export
  ```
  The session cookie comes from a prior login; on desktop (Tauri, `AUTH_MODE=none`) the cookie isn't required. The output is already encrypted, so it doesn't need its own encrypted folder the way a plain-JSON export would have.
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
- [Attachments](./attachments) — the separate archive channel for receipts and invoices, and how the scheduled runner picks them up only on change.
- [Security and privacy](./security-and-privacy)
- [Encryption at rest](./encryption-at-rest)
