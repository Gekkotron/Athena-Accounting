# Mandatory backup passphrase + desktop encryption at rest

**Date:** 2026-07-27
**Status:** approved (option B chosen by owner)

Two related security features, independently shippable. Part 1 is small and
ships first; Part 2 changes the desktop persistence model.

---

## Part 1 — Mandatory backup passphrase

### Behavior

- `GET /api/backup/export` (plaintext) is **removed**: it returns `410 Gone`
  with `{ error: 'plaintext export removed — POST with a passphrase' }`. It
  stays registered (410, not 404) so old clients get an explanation.
- `POST /api/backup/export` is unchanged: passphrase required (min 8, max
  1024), output is always an `enc1` AES-256-GCM envelope.
- **Import is unchanged**: `POST /api/backup/import` keeps accepting both
  encrypted envelopes and legacy plaintext dumps. Historical backups must
  keep restoring forever; only the *creation* of plaintext backups stops.

### Frontend (`pages/Imports/BackupPanel.tsx`)

- The export passphrase field becomes required: export button disabled until
  the passphrase has ≥ 8 characters; the "optional" copy is replaced by a
  warning that a lost passphrase makes the backup unreadable.
- Import side untouched.
- Demo mode: the demo write handler for export mirrors the 410-on-GET.

### Tests

- Backend `tests/backup-route.test.ts`: GET export asserts 410; POST export
  path already covered.
- Frontend: BackupPanel test — export disabled without passphrase, enabled
  with one.

---

## Part 2 — Desktop encryption at rest (Option B: in-memory + encrypted snapshots)

### Threat model / guarantees

- Protects account data on disk when the machine is off, stolen, or the app
  is not running. Plaintext **never touches disk** once enabled — even a
  crash leaks nothing.
- While the app runs, data lives in process memory only (same exposure as
  any running app).
- **No recovery**: password loss = data loss. The enable flow says this in
  unmissable copy; exported backups are the escape hatch.
- Scope: desktop / PGlite driver only. LAN installs (DB_DRIVER=postgres) are
  out of scope and unaffected. Opt-in via Settings; off by default.

### Storage format

- `DATA_DIR/athena.db.enc` — current snapshot: binary header (magic
  `ATHENA-DB-ENC v1`, scrypt params, salt, IV, GCM tag) + ciphertext of the
  `dumpDataDir()` tarball. Crypto primitives shared with
  `backup/crypto.ts` (extracted into a common helper).
- `DATA_DIR/athena.db.enc.bak` — previous generation, kept on every swap.
- `DATA_DIR/security.json` — mode marker `{ mode: 'encrypted' }` plus KDF
  params; must be readable before unlock, so it cannot live in the DB.
- Atomic swap: write `.tmp` → fsync → rename current → `.bak` → rename
  `.tmp` → current.
- Password verification is the GCM auth tag (successful decrypt = correct
  password); no separate hash is stored.

### Runtime flow

1. **Locked boot**: when `security.json` says `encrypted`, the sidecar
   starts a minimal unlock server on the port it advertises via
   `ATHENA_PORT` — it serves the unlock page, `POST /api/unlock`, and
   answers `423 Locked` to everything else (including MCP clients).
2. **Unlock**: correct password → snapshot decrypted → PGlite created
   **in-memory** with `loadDataDir` → migrations → the real Fastify app
   takes over the same port (unlock server closes first; the unlock page
   reloads with retry to ride out the rebind gap).
3. **Snapshots**: a dirty flag is set by an `onResponse` hook on mutating
   requests; a trailing 10 s debounce runs `dumpDataDir()` → encrypt →
   atomic swap. At most one snapshot in flight (coalesced). Immediate
   snapshot after backup restore and file imports; final snapshot on
   SIGTERM shutdown.
4. **Crash window**: changes since the newest snapshot are lost on
   crash/power cut. Accepted trade-off of Option B; the debounce keeps the
   window ≈ 10 s.

### Enable / disable / change password

- **Enable** (Settings → set password twice): live `dumpDataDir()` →
  encrypt → write snapshot → **verify it decrypts** → write marker. The
  plaintext datadir is deleted on the next clean shutdown (after the final
  snapshot). If the app crashes in between, the next start finalizes the
  migration: open plaintext dir, dump, encrypt, delete plaintext, reopen
  in-memory.
- **Disable** (requires current password): decrypt snapshot → create PGlite
  with `dataDir` = plaintext path + `loadDataDir` = snapshot (PGlite
  populates the directory) → remove `athena.db.enc*` and marker → restart
  persistence in datadir mode.
- **Change password** (requires current password): fresh live dump →
  encrypt under the new password → swap. No DB reload.

### Frontend

- **Unlock screen**: minimal page (logo, password field, error state),
  served pre-unlock; FR/EN copy.
- **Settings → Sécurité**: enable (password + confirm + red no-recovery
  warning), change password, disable. Only rendered on the PGlite driver:
  `/health` gains `driver: 'pglite' | 'postgres'` and
  `locked: boolean` fields the SPA reads at boot.
- API client: a `423` response routes the SPA to the unlock screen.

### Interactions with existing machinery

- Single-instance lock (`.sidecar.lock`) and the parent watchdog work
  unchanged — both are independent of persistence mode.
- The TRUNCATE restore path works identically on an in-memory instance.
- In-memory mode incidentally retires the poisoned-datadir failure class
  fixed earlier: every boot starts from a consistent snapshot.

### Tests

- Crypto/envelope: encrypt → decrypt roundtrip, wrong password fails, tamper
  fails (unit).
- Snapshot store: atomic swap leaves a valid current + bak under simulated
  interruption (unit, temp dirs).
- Flow: enable → unlock → mutate → snapshot → relaunch-equivalent reload →
  data present; disable roundtrip (integration tests using in-memory PGlite,
  no external services needed).

### Out of scope (v1)

- Auto-lock timer, "lock now" button, per-session re-lock.
- Encrypting the LAN/Postgres deployment.
- Key files / hardware tokens; passphrase only.
