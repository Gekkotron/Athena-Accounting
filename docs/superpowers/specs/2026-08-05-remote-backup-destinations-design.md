# Scheduled remote backup destinations (WebDAV + folder)

**Date:** 2026-08-05
**Status:** approved

Today backups are manual: the user POSTs a passphrase to
`/api/backup/export` and the browser downloads an `enc1`-sealed JSON dump.
This feature adds **scheduled, unattended backups pushed to a remote
destination** — a WebDAV server (Freebox, Synology, QNAP, Nextcloud) or a
local/mounted folder (SMB/NFS mount, external disk). Google Drive is
deliberately out of scope (BYO OAuth is heavy setup and fights the
LAN-only positioning; users who want cloud can sync the folder destination
with rclone or the NAS's own cloud tooling).

One destination per user in v1. Backups remain always-encrypted; the
restore path is unchanged (download the `.enc.json` from the destination,
use the existing restore flow).

---

## 1. Data model

New table `backup_destinations`, one row per user (mirrors
`bank_sync_credentials`):

- `userId` — unique FK.
- `kind` — `'webdav' | 'folder'`.
- `config` (JSON) — non-secret settings:
  - webdav: `url`, `username`, optional remote subdirectory.
  - folder: absolute `path`.
  - shared: `keepLast` (int, default 30, min 1).
- `secretEncrypted` — WebDAV password (empty/null for folder), encrypted
  at rest.
- `passphraseEncrypted` — the backup encryption passphrase (min 8, max
  1024, same bounds as manual export). Stored because scheduled runs must
  seal the dump unattended.
- `enabled` (bool), `lastRunAt`, `lastError` (nullable text),
  `updatedAt`.

Both secrets are encrypted exactly like the bank-sync private key: key
derived from `SESSION_SECRET`, per-user AAD, reusing/generalizing the
helpers in `domain/bank-sync/crypto.ts`.

The schedule hour is a new `backupHour` field in `userSettings`
(`domain/settings/schema.ts`), next to `bankSyncHour` — int 0–23,
default 3.

## 2. Providers

New module `backend/src/domain/backup/providers.ts` with a minimal
interface:

```ts
interface BackupDestination {
  upload(name: string, bytes: Buffer): Promise<void>;
  list(): Promise<string[]>;          // backup filenames only
  remove(name: string): Promise<void>;
}
```

- **Folder provider** — `node:fs/promises` against the configured
  directory. Write via temp file + rename so a crash never leaves a
  truncated backup. Path must be absolute.
- **WebDAV provider** — plain `fetch`, no new npm dependency:
  - `PUT <url>/<subdir>/<name>` to upload (create the subdir with
    `MKCOL` if the first PUT 409s).
  - `PROPFIND` depth 1 to list; only `<href>` extraction is needed, no
    full XML parser.
  - `DELETE` to prune.
  - HTTP Basic auth. `https` and `http` both accepted (Freebox on the
    LAN is plain http); the UI copy notes that http sends the password
    unencrypted on the LAN — the backup payload itself is always sealed.

Retention and filenames are provider-agnostic: files are named
`athena-backup-<YYYY-MM-DD-HHMMSS>.enc.json` (same stamp as manual
export); `list()` filters to that pattern so pruning can **never** delete
a foreign file.

## 3. Scheduler

`backend/src/domain/backup/scheduler.ts`, copying the
`domain/imports/bank-sync.ts` tick pattern:

- Boot-delayed `setInterval` tick; each tick asks which users have an
  `enabled` destination whose `backupHour` occurrence (via
  `nextScheduledOccurrence` from `bank-sync-core.ts`) has passed since
  the last successful run.
- Per due user: build the dump (extract `buildDump` from
  `routes/backup/export.ts` into `domain/backup/dump.ts` so route and
  scheduler share it), seal with `encryptEnvelope` under the stored
  passphrase, `upload()`, then prune oldest files beyond `keepLast`.
- Success sets `lastRunAt` and clears `lastError`; any failure is caught
  per user, recorded in `lastError`, and never crashes the tick.
- At most one backup per user per day (a failed run retries on the next
  tick, not a success).

## 4. API + UI

Routes registered in the existing `backup` plugin (auth required),
`routes/backup/destination.ts`:

- `GET /api/backup/destination` — configured?, kind, non-secret config,
  enabled, `backupHour`, `lastRunAt`, `lastError`, next scheduled run.
  Secrets are never echoed back.
- `PUT /api/backup/destination` — validates the config by performing a
  real test write + delete against the destination before persisting
  (mirror of bank-sync validating credentials live). Rejects with a
  useful error (connection refused, 401, permission denied) instead of
  storing a broken destination.
- `DELETE /api/backup/destination` — removes the row (and its secrets).
- `POST /api/backup/destination/run-now` — runs one backup immediately
  with the stored config; returns the uploaded filename or the error.

Frontend — a "Sauvegarde distante" card on the Data → Backup page
(`pages/Data/Backup.tsx`, extracting a `RemoteBackupCard` component to
respect the 300-line lint ceiling):

- Provider picker (WebDAV / Dossier local) with the matching fields;
  passphrase field with the same lost-passphrase warning as manual
  export; hour picker; keep-last-N (text input + `parseDecimal`
  convention — no `<input type="number">`).
- Buttons: "Tester et enregistrer" (PUT) and "Sauvegarder maintenant"
  (run-now); last-run status line (date + error if any).
- Demo mode: demo write handlers return a plausible fake status; no real
  writes.

## 5. Tests

- Provider units: folder via temp dir (incl. rename atomicity and
  pruning); WebDAV via injected fake `fetch` (fake-fetch-only, same
  policy as bank-sync — no live network in tests).
- Scheduler: due-time logic around `backupHour`, one-per-day semantics,
  failure recording, retention pruning.
- Routes: PUT validation failure paths, secret round-trip
  (encrypt/decrypt), GET never leaks secrets, run-now happy + error.
- Frontend: card renders per kind, save/test flows, demo handlers.

## 6. Documentation

Same change, Docusaurus site:

- `docs/users/backup-recovery.md` — new "Remote backup" section:
  configuring WebDAV for a Freebox / Synology / Nextcloud, mounted-folder
  setup, schedule hour, retention, restoring from a remote copy.
- `docs/reference/api-endpoints.md` — the four new endpoints.
- `docs/users/security-and-privacy.md` + `docs/users/encryption-at-rest.md` —
  note that destination secrets are encrypted at rest and pushed dumps
  are always sealed.
- Mirror all of the above in the French copies under
  `website/i18n/fr/docusaurus-plugin-content-docs/current/`.
- `docs/contributors/code-map.md` — add the new `domain/backup/` module.
