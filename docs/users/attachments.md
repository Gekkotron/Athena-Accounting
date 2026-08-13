---
title: Attachments
sidebar_position: 5
---

# Attachments

Attach receipts, invoices, or contracts to a transaction so the paper
trail lives right next to the row it explains. Attachments are stored
locally on your Athena instance — Athena's LAN-only, no-cloud stance
applies to them exactly like the rest of your data.

## What can be attached

Every attachment is uploaded through *Transactions → open a row → Pièces
jointes → Ajouter…*. Accepted file types (sniffed from the file's magic
bytes, not the extension or the browser's `Content-Type`):

- **Images**: JPEG, PNG, WebP, HEIC (typical phone-photo formats).
- **PDF**: single or multi-page documents.

Anything else is rejected with a French error before it lands on disk.

## Size and count limits

- **10 MB per file**, hard cap. Files above that limit are rejected
  client-side before the upload starts and again server-side (a 413
  response) if a caller bypasses the browser.
- **No hard per-transaction limit**. In practice, attaching more than a
  handful of large PDFs to one transaction makes the modal slow to
  render — split them across related transactions if you can.

The paperclip icon on the transactions list shows the count next to the
label for any row that has attachments.

## Where files are stored

Attachments live on your Athena machine's disk under
`<DATA_DIR>/attachments/<user_id>/<attachment_id>.bin`. Only the
metadata (original filename, MIME type, size, creation date) is written
to the database — the bytes are never inlined in the Postgres/PGlite
row, so backups and desktop-app database exports stay small.

`<DATA_DIR>` depends on how you're running Athena — see the [installing
guide](./desktop-install.md) and the [configuration
reference](../reference/configuration.md) for the exact resolution
rules:

- **Docker**: inside the container it is `/data`, which docker-compose
  mounts to a named volume (or the path you configured). Include that
  volume in your host-level backup routine to preserve attachments.
- **Desktop app**: the per-OS user data directory (macOS
  `~/Library/Application Support/Athena/`, Windows
  `%APPDATA%\Athena\`, Linux `~/.local/share/Athena/`), with the
  `attachments/` subdirectory next to the PGlite database file.
- **Bare-metal / `npm start`**: the current working directory unless
  `DATA_DIR` is set explicitly.

Only Athena is expected to write inside `attachments/` — do not add,
rename, or delete files there by hand. The database and the disk go
out of sync silently if you do.

## Backups

Attachments have their own **separate backup channel** — they are
deliberately not inlined in the main JSON dump. A single receipt
library can weigh hundreds of megabytes over time; inlining that as
base64 would inflate every dump linearly and multiply the passphrase
encryption cost. Two channels keep the JSON dump lean and let the
attachment archive re-upload only when it actually changed.

- **Manual export**: *Données → Sauvegarde → Exporter les pièces
  jointes* streams an encrypted binary archive
  (`athena-attachments-YYYY-MM-DD-HHMMSSmmm.bin`). Same passphrase
  scheme as the JSON dump: AES-256-GCM under a scrypt-derived key. A
  wrong passphrase on restore fails cleanly without touching your
  current data.
- **Manual restore**: *Données → Sauvegarde → Importer les pièces
  jointes* accepts the encrypted archive. REPLACE semantics for the
  calling user: current attachments are wiped from DB + disk, then the
  archive's entries are re-linked to their matching transactions via
  the `(account name, dedup key)` natural key. Entries whose parent
  transaction was deleted or renamed are skipped silently and reported
  in the summary.
- **Scheduled backup**: when a remote destination is configured (folder,
  WebDAV, or FTP), each nightly run always uploads a fresh JSON dump.
  The attachment archive is uploaded **only when your attachment
  library has changed since the last successful upload** — Athena
  fingerprints the current library (row count + newest timestamp) and
  compares it to the fingerprint stored on the destination. Unchanged
  → skipped, saving bandwidth and remote storage on quiet days. The
  keep-last retention applies to each family independently.

If you are backing up the whole machine outside of Athena's routine
(rsync, Time Machine, borg…), including `<DATA_DIR>/attachments/` in
that backup is enough — you don't have to run Athena's archive export
too.

## Deleting

*Pièces jointes → Supprimer* removes both the database row and the file
on disk in one step (a confirm dialog protects against slips). If the
parent transaction itself is deleted, its attachments cascade with it
— rows disappear from the database, and the files on disk are cleaned
up on the next attachment write for that user. Manual disk cleanup is
never required.

## Privacy

- Attachments never leave your machine unless you export them
  explicitly.
- The stored files are **not encrypted at rest** by default — they sit
  on disk with the file permissions your OS gave them. For a stronger
  boundary, host Athena on a full-disk-encrypted volume, or wrap
  `<DATA_DIR>` in an encrypted container (LUKS, VeraCrypt, FileVault).
- The manual and scheduled backup archives **are** encrypted end-to-end
  with your passphrase, so you can push them to any storage you don't
  fully trust without exposing receipts.

## See also

- [Importing](./importing.md) — file-based imports feed the transactions
  that host these attachments.
- [Backup and recovery](./backup-recovery.md) — the general backup story,
  including how the JSON dump and the attachments archive share a
  passphrase.
- [Security and privacy](./security-and-privacy.md) — Athena's overall
  security model, including local-only storage.
