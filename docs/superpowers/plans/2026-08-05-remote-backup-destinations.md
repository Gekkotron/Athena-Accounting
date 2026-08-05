# Remote Backup Destinations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-08-05-remote-backup-destinations-design.md` (approved)

**Goal:** Scheduled, unattended, always-encrypted backups pushed to a per-user remote destination — a WebDAV server or a local/mounted folder — with retention pruning, a run-now button, and a settings card on the Sauvegarde page.

**Architecture:** A new `backend/src/domain/backup/` module: provider abstraction (folder via `node:fs/promises`, WebDAV via plain `fetch` — no new npm dependency), a store that encrypts the WebDAV password and the backup passphrase at rest (same AES-256-GCM/HKDF construction as `domain/bank-sync/crypto.ts`), a runner shared by the run-now route and a 15-min-tick scheduler copied from the bank-sync scheduler pattern. `buildDump` moves out of the export route into the domain so route and scheduler share it. Frontend is one `RemoteBackupCard` on the existing Sauvegarde page.

**Tech Stack:** Fastify + Drizzle + zod (backend), Node built-ins only (`node:crypto`, `node:fs/promises`, global `fetch`), React + react-query + i18next (frontend), vitest both sides.

## Global Constraints

- **No new npm dependency** — WebDAV over plain `fetch`, crypto via `node:crypto`.
- **No live network in tests** — WebDAV tests use an injected fake fetch (`__setBackupFetchForTests`), same policy as bank-sync's `__setEbFetchForTests`.
- **Secrets never echoed** — no GET returns the WebDAV password or the backup passphrase; neither may appear in logs.
- **Backups always encrypted** — pushed files are the existing `enc1` envelope (`routes/backup/crypto.ts`), passphrase min 8 / max 1024 (same bounds as manual export).
- **Pruning can never delete a foreign file** — `list()` filters to `athena-backup-<YYYY-MM-DD-HHMMSS>.enc.json` before any `remove()`.
- **No `<input type="number">`** — text input + `inputMode` + validation in a pure lib (`parseDecimal` convention; keepLast is an integer so a digits-only check applies).
- **Frontend lint ceiling: 300 lines/file is a CI error** — the card is a separate component + a pure lib file.
- **Commits on `main`, one per task**, identity flags on every commit: `git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit …`. Never push unless the user asks.
- **DB test invocation:** `cd backend && DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run tests/<file>`; pure tests run without the env vars. Frontend: `cd frontend && npx vitest run`, `npx tsc -b`, `npm run build` (+ `VITE_DEMO=1 npm run build` when demo files change).
- Backend route files follow the house shape: `register<Thing>Route(app)` functions composed by the plugin index, `userId(req)` from `http/plugins/auth.js`, zod `safeParse` → 400 `{ error: 'invalid input', issues }`.

---

### Task 1: Migration, Drizzle table, `backupHour` setting, `BACKUP_AUTO` env

**Files:**
- Create: `backend/src/db/migrations/0031_backup_destinations.sql`
- Modify: `backend/src/db/schema.ts` (append after `bankConnectionAccounts` block)
- Modify: `backend/src/domain/settings/schema.ts:25` (add `backupHour` next to `bankSyncHour`)
- Modify: `backend/src/domain/settings/defaults.ts` (add `backupHour: 3`)
- Modify: `backend/src/env.ts:46` (add `BACKUP_AUTO` next to `BANK_SYNC_AUTO`)
- Modify: `frontend/src/lib/settings.ts` (paint-safe duplicate: `backupHour` in `Settings` + `DEFAULTS`)
- Modify: `.env.example` (document `BACKUP_AUTO` under the `BANK_SYNC_AUTO` block)
- Test: `backend/tests/settings-backup-hour.test.ts`

**Interfaces:**
- Produces: Drizzle export `backupDestinations` (columns: `userId` PK, `kind`, `config` jsonb, `secretEncrypted` nullable, `passphraseEncrypted`, `enabled`, `lastRunAt` nullable, `lastError` nullable, `createdAt`, `updatedAt`); `mergeSettings(...).backupHour: number` (default 3); `env.BACKUP_AUTO: boolean` (default true).

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/settings-backup-hour.test.ts
import { describe, it, expect } from 'vitest';
import { mergeSettings, SettingsSchema } from '../src/domain/settings/schema.js';

describe('settings.backupHour', () => {
  it('defaults to 3', () => {
    expect(mergeSettings({}).backupHour).toBe(3);
  });
  it('accepts a stored value 0-23', () => {
    expect(mergeSettings({ backupHour: 22 }).backupHour).toBe(22);
  });
  it('rejects out-of-range patches at the schema layer', () => {
    expect(SettingsSchema.safeParse({ backupHour: 24 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ backupHour: -1 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ backupHour: 3 }).success).toBe(true);
  });
  it('a garbage stored blob falls back to the default', () => {
    expect(mergeSettings({ backupHour: 'noon' }).backupHour).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/settings-backup-hour.test.ts`
Expected: FAIL — `backupHour` is `undefined` / not in schema.

- [ ] **Step 3: Implement**

`backend/src/domain/settings/schema.ts` — inside the zod object, after `bankSyncHour`:
```ts
    backupHour: z.number().int().min(0).max(23).optional(),
```
and in `FullSettings`: `backupHour: number;`

`backend/src/domain/settings/defaults.ts` — after `bankSyncHour: 2,`:
```ts
  // Local hour (0-23, server clock) of the unattended remote backup.
  // 03:00 by default — after the 02:00 bank sync so the backup catches it.
  backupHour: 3,
```

`frontend/src/lib/settings.ts` — mirror both: `backupHour: number;` in `Settings`, `backupHour: 3,` in `DEFAULTS`.

`backend/src/env.ts` — next to `BANK_SYNC_AUTO: boolish.default(true),`:
```ts
    BACKUP_AUTO: boolish.default(true),
```

`backend/src/db/migrations/0031_backup_destinations.sql`:
```sql
-- Per-user remote backup destination for scheduled, unattended backups
-- (WebDAV server or local/mounted folder). One row per user, like
-- bank_sync_credentials.
--
-- Design notes:
--   * config is non-secret JSON: webdav {url, username, subdir?}, folder
--     {path}, shared {keepLast}.
--   * secret_encrypted (WebDAV password, NULL for folder) and
--     passphrase_encrypted (the enc1 backup passphrase — stored because
--     scheduled runs must seal the dump unattended) are both
--     base64(nonce || ciphertext || tag) from AES-256-GCM under a
--     SESSION_SECRET-derived key with the user id + field bound as AAD
--     (see backend/src/domain/backup/secrets.ts). Plaintext is never
--     stored and never returned by any endpoint.
CREATE TABLE backup_destinations (
  user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL CHECK (kind IN ('webdav', 'folder')),
  config                JSONB NOT NULL,
  secret_encrypted      TEXT,
  passphrase_encrypted  TEXT NOT NULL,
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at           TIMESTAMPTZ,
  last_error            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`backend/src/db/schema.ts` — append (reuse the existing `pgTable, integer, text, jsonb, boolean, timestamp` imports; add any missing to the import list):
```ts
// ---------------------------------------------------------------------------
// backup_destinations — per-user remote backup destination (migration 0031).
// One row per user: WebDAV or folder target for scheduled encrypted backups.
// secret_encrypted (WebDAV password) and passphrase_encrypted (enc1 backup
// passphrase) are AES-256-GCM-encrypted under a SESSION_SECRET-derived key
// (see domain/backup/secrets.ts). Plaintext secrets never leave the backend.
// ---------------------------------------------------------------------------

export const backupDestinations = pgTable('backup_destinations', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  config: jsonb('config').notNull(),
  secretEncrypted: text('secret_encrypted'),
  passphraseEncrypted: text('passphrase_encrypted').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

`.env.example` — under the `BANK_SYNC_AUTO` block:
```
# Scheduled remote backups (Sauvegarde → Sauvegarde distante). Set to 0 to
# disable the scheduler; the run-now button still works.
# BACKUP_AUTO=1
```

- [ ] **Step 4: Run tests + verify the migration applies on pglite**

Run: `cd backend && npx vitest run tests/settings-backup-hour.test.ts` → PASS
Run: `cd backend && DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run tests/pglite-smoke.test.ts` → PASS (migration 0031 applies)
Run: `cd backend && npx tsc -b` and `cd frontend && npx tsc -b` → clean

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/0031_backup_destinations.sql backend/src/db/schema.ts \
  backend/src/domain/settings/schema.ts backend/src/domain/settings/defaults.ts \
  backend/src/env.ts frontend/src/lib/settings.ts .env.example backend/tests/settings-backup-hour.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(backup): backup_destinations table, backupHour setting, BACKUP_AUTO env"
```

---

### Task 2: Secrets encryption module

**Files:**
- Create: `backend/src/domain/backup/secrets.ts`
- Test: `backend/tests/backup-secrets.test.ts`

**Interfaces:**
- Produces: `backupSecretsKey(sessionSecret: string): Buffer`; `encryptSecret(key: Buffer, userId: number, field: 'secret' | 'passphrase', plaintext: string): string`; `decryptSecret(key: Buffer, userId: number, field: 'secret' | 'passphrase', stored: string): string`.
- House pattern note: `domain/mcp/crypto.ts` and `domain/bank-sync/crypto.ts` deliberately duplicate this small construction per domain rather than share a module (distinct HKDF salts keep key material domain-separated). Follow that — do NOT modify `domain/bank-sync/crypto.ts` (its constants protect existing ciphertexts).

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/backup-secrets.test.ts
import { describe, it, expect } from 'vitest';
import { backupSecretsKey, encryptSecret, decryptSecret } from '../src/domain/backup/secrets.js';

const KEY = backupSecretsKey('test-session-secret');

describe('backup destination secrets crypto', () => {
  it('round-trips a secret', () => {
    const stored = encryptSecret(KEY, 7, 'passphrase', 'corr3ct horse');
    expect(stored).not.toContain('horse');
    expect(decryptSecret(KEY, 7, 'passphrase', stored)).toBe('corr3ct horse');
  });
  it('a ciphertext moved to another user fails authentication', () => {
    const stored = encryptSecret(KEY, 7, 'passphrase', 'corr3ct horse');
    expect(() => decryptSecret(KEY, 8, 'passphrase', stored)).toThrow();
  });
  it('a ciphertext moved to the other field fails authentication', () => {
    const stored = encryptSecret(KEY, 7, 'secret', 'webdav-password');
    expect(() => decryptSecret(KEY, 7, 'passphrase', stored)).toThrow();
  });
  it('a different session secret fails', () => {
    const stored = encryptSecret(KEY, 7, 'secret', 'webdav-password');
    expect(() => decryptSecret(backupSecretsKey('other'), 7, 'secret', stored)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/backup-secrets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// backend/src/domain/backup/secrets.ts
import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// Encryption at rest for remote-backup destination secrets: the WebDAV
// password and the enc1 backup passphrase. Same construction as
// domain/bank-sync/crypto.ts: AES-256-GCM under a key derived from
// SESSION_SECRET via HKDF-SHA256, with the owning user id AND the field
// name bound as AAD — a ciphertext copied onto another user's row, or
// swapped between the two secret columns, fails authentication.

const HKDF_SALT = 'athena-backup-destination-v1';
const HKDF_INFO = 'secrets-key';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export type SecretField = 'secret' | 'passphrase';

export function backupSecretsKey(sessionSecret: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(sessionSecret, 'utf8'), Buffer.from(HKDF_SALT), Buffer.from(HKDF_INFO), 32),
  );
}

function aad(userId: number, field: SecretField): Buffer {
  return Buffer.from(`backup-destination:${userId}:${field}`, 'utf8');
}

// Returns base64(nonce || ciphertext || tag).
export function encryptSecret(key: Buffer, userId: number, field: SecretField, plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(userId, field));
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, enc, cipher.getAuthTag()]).toString('base64');
}

export function decryptSecret(key: Buffer, userId: number, field: SecretField, stored: string): string {
  const buf = Buffer.from(stored, 'base64');
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const enc = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const d = createDecipheriv('aes-256-gcm', key, nonce);
  d.setAAD(aad(userId, field));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/backup-secrets.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/backup/secrets.ts backend/tests/backup-secrets.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(backup): AES-256-GCM secrets module for destination password + passphrase"
```

---

### Task 3: Extract `buildDump` + filename helpers into `domain/backup/dump.ts`

**Files:**
- Create: `backend/src/domain/backup/dump.ts`
- Modify: `backend/src/http/routes/backup/export.ts` (delete the inline `buildDump` at lines 27–167 and `stampNow` at 171–178; import from the domain instead)
- Test: `backend/tests/backup-filename.test.ts`

**Interfaces:**
- Consumes: `VERSION`, `fileImportKey` from `http/routes/backup/schema.js` (unchanged).
- Produces: `buildDump(uid: number): Promise<object>` (the exact dump the export route emits today — move the function body verbatim, including its comment block); `backupFilename(now: Date): string` → `athena-backup-YYYY-MM-DD-HHMMSS.enc.json` (local time, same stamp as today's `stampNow`); `isBackupFilename(name: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/backup-filename.test.ts
import { describe, it, expect } from 'vitest';
import { backupFilename, isBackupFilename } from '../src/domain/backup/dump.js';

describe('backup filenames', () => {
  it('stamps local time as athena-backup-YYYY-MM-DD-HHMMSS.enc.json', () => {
    const name = backupFilename(new Date(2026, 7, 5, 3, 7, 9)); // 2026-08-05 03:07:09 local
    expect(name).toBe('athena-backup-2026-08-05-030709.enc.json');
  });
  it('its own output round-trips the filter', () => {
    expect(isBackupFilename(backupFilename(new Date()))).toBe(true);
  });
  it('rejects foreign files so pruning can never touch them', () => {
    for (const bad of [
      'holiday-photos.zip',
      'athena-backup-2026-08-05.enc.json',        // no time component
      'athena-backup-2026-08-05-030709.json',      // not sealed
      'xathena-backup-2026-08-05-030709.enc.json', // prefix must anchor
      '.tmp-athena-backup-2026-08-05-030709.enc.json',
    ]) expect(isBackupFilename(bad)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/backup-filename.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`backend/src/domain/backup/dump.ts`: move `buildDump` (with its imports: drizzle `eq`, `db`, the table list, `VERSION`, `fileImportKey`) verbatim from `export.ts`, plus:

```ts
// Local-time stamp so multiple backups on the same day stay distinct.
// Shared by the manual export route and the scheduled remote-backup runner.
export function backupFilename(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `athena-backup-${stamp}.enc.json`;
}

// Retention pruning filters on this before deleting ANYTHING — a foreign
// file sitting in the destination directory must never match.
export function isBackupFilename(name: string): boolean {
  return /^athena-backup-\d{4}-\d{2}-\d{2}-\d{6}\.enc\.json$/.test(name);
}
```

`export.ts` shrinks to the two route handlers: import `buildDump`, `backupFilename` from `../../../domain/backup/dump.js`; the Content-Disposition line becomes:
```ts
reply.header('Content-Disposition', `attachment; filename="${backupFilename(new Date())}"`);
```
Remove the now-unused table imports and `stampNow` from `export.ts`.

- [ ] **Step 4: Run tests — new unit + the existing backup route suite (guards the extraction)**

Run: `cd backend && npx vitest run tests/backup-filename.test.ts` → PASS
Run: `cd backend && DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run tests/backup-route.test.ts tests/backup-schema.test.ts` → PASS (same counts as before the change)
Run: `cd backend && npx tsc -b` → clean

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/backup/dump.ts backend/src/http/routes/backup/export.ts backend/tests/backup-filename.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "refactor(backup): extract buildDump + filename helpers to domain/backup/dump.ts"
```

---

### Task 4: Folder provider

**Files:**
- Create: `backend/src/domain/backup/providers.ts` (folder half + shared interface/error)
- Test: `backend/tests/backup-provider-folder.test.ts`

**Interfaces:**
- Consumes: `isBackupFilename` from `./dump.js`.
- Produces:
```ts
export interface BackupProvider {
  upload(name: string, bytes: Buffer): Promise<void>;
  list(): Promise<string[]>;          // backup filenames only, pre-filtered
  remove(name: string): Promise<void>;
}
export class BackupProviderError extends Error {}
export function createFolderProvider(dirPath: string): BackupProvider;
```

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/backup-provider-folder.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFolderProvider, BackupProviderError } from '../src/domain/backup/providers.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'athena-backup-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const NAME = 'athena-backup-2026-08-05-030000.enc.json';

describe('folder provider', () => {
  it('requires an absolute path', () => {
    expect(() => createFolderProvider('relative/dir')).toThrow(BackupProviderError);
  });
  it('uploads via temp file + rename and leaves no temp behind', async () => {
    const p = createFolderProvider(dir);
    await p.upload(NAME, Buffer.from('{"v":"enc1"}'));
    expect((await readFile(join(dir, NAME))).toString()).toBe('{"v":"enc1"}');
    expect(await readdir(dir)).toEqual([NAME]); // no .tmp-* residue
  });
  it('a failed write cleans up its temp file', async () => {
    const p = createFolderProvider(join(dir, 'does-not-exist'));
    await expect(p.upload(NAME, Buffer.from('x'))).rejects.toThrow(BackupProviderError);
  });
  it('list() returns only backup-named files', async () => {
    const p = createFolderProvider(dir);
    await p.upload(NAME, Buffer.from('x'));
    await writeFile(join(dir, 'holiday-photos.zip'), 'not ours');
    expect(await p.list()).toEqual([NAME]);
  });
  it('remove() deletes a backup file and rejects path traversal', async () => {
    const p = createFolderProvider(dir);
    await p.upload(NAME, Buffer.from('x'));
    await p.remove(NAME);
    expect(await readdir(dir)).toEqual([]);
    await expect(p.remove('../evil')).rejects.toThrow(BackupProviderError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/backup-provider-folder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// backend/src/domain/backup/providers.ts
import { readdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { isBackupFilename } from './dump.js';

// Destination abstraction for scheduled remote backups. Two providers:
// a local/mounted folder (SMB/NFS mount, external disk) and WebDAV
// (Freebox, Synology, QNAP, Nextcloud) over plain fetch — no npm dep.
// list() pre-filters to backup-named files so retention pruning can NEVER
// delete a foreign file living in the same directory.

export interface BackupProvider {
  upload(name: string, bytes: Buffer): Promise<void>;
  list(): Promise<string[]>;
  remove(name: string): Promise<void>;
}

export class BackupProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupProviderError';
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Names come from our own stamp or the PUT-validation probe; anything with
// a path separator is refused outright.
function assertPlainName(name: string): void {
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new BackupProviderError(`invalid backup filename: ${name}`);
  }
}

export function createFolderProvider(dirPath: string): BackupProvider {
  // A relative path would resolve against the server's cwd — always a bug.
  if (!isAbsolute(dirPath)) throw new BackupProviderError('folder path must be absolute');
  return {
    async upload(name, bytes) {
      assertPlainName(name);
      // Temp file + rename: a crash mid-write never leaves a truncated
      // backup under a name the pruner (or the user) would trust. The
      // directory must already exist — creating it here would silently
      // write to a local stub when an SMB/NFS mount is down.
      const tmp = join(dirPath, `.tmp-${name}`);
      try {
        await writeFile(tmp, bytes);
        await rename(tmp, join(dirPath, name));
      } catch (err) {
        await rm(tmp, { force: true }).catch(() => {});
        throw new BackupProviderError(`folder write failed: ${errMsg(err)}`);
      }
    },
    async list() {
      try {
        return (await readdir(dirPath)).filter(isBackupFilename).sort();
      } catch (err) {
        throw new BackupProviderError(`folder list failed: ${errMsg(err)}`);
      }
    },
    async remove(name) {
      assertPlainName(name);
      try {
        await rm(join(dirPath, name), { force: true });
      } catch (err) {
        throw new BackupProviderError(`folder delete failed: ${errMsg(err)}`);
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/backup-provider-folder.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/backup/providers.ts backend/tests/backup-provider-folder.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(backup): folder destination provider — atomic writes, filtered listing"
```

---

### Task 5: WebDAV provider

**Files:**
- Modify: `backend/src/domain/backup/providers.ts` (append the WebDAV half)
- Test: `backend/tests/backup-provider-webdav.test.ts`

**Interfaces:**
- Produces:
```ts
export function createWebdavProvider(
  cfg: { url: string; username: string; subdir: string | null },
  password: string,
): BackupProvider;
export function __setBackupFetchForTests(f: typeof fetch | null): void;
```
- Behavior contract: `PUT <url>[/<subdir>]/<name>` to upload (on 409, `MKCOL` each subdir segment then retry the PUT once); `PROPFIND` Depth 1 to list (extract `<href>`s with a regex, decode, take the basename, filter `isBackupFilename`; a 404 directory lists as empty); `DELETE` to prune (404 tolerated). HTTP Basic auth. 401/403 map to readable errors.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/backup-provider-webdav.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  createWebdavProvider,
  __setBackupFetchForTests,
  BackupProviderError,
} from '../src/domain/backup/providers.js';

type Call = { method: string; url: string; headers: Record<string, string> };
const NAME = 'athena-backup-2026-08-05-030000.enc.json';

function fakeFetch(script: (call: Call, n: number) => Response): Call[] {
  const calls: Call[] = [];
  __setBackupFetchForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
    };
    calls.push(call);
    return script(call, calls.length);
  }) as typeof fetch);
  return calls;
}

afterEach(() => __setBackupFetchForTests(null));

const CFG = { url: 'http://nas.local:5005/dav/', username: 'julien', subdir: 'athena' };

describe('webdav provider', () => {
  it('uploads with basic auth to url/subdir/name', async () => {
    const calls = fakeFetch(() => new Response(null, { status: 201 }));
    await createWebdavProvider(CFG, 'p4ss').upload(NAME, Buffer.from('x'));
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe(`http://nas.local:5005/dav/athena/${NAME}`);
    expect(calls[0].headers.authorization).toBe('Basic ' + Buffer.from('julien:p4ss').toString('base64'));
  });
  it('a 409 PUT creates the collection with MKCOL then retries once', async () => {
    const calls = fakeFetch((call, n) =>
      n === 1 ? new Response(null, { status: 409 }) : new Response(null, { status: call.method === 'MKCOL' ? 201 : 201 }),
    );
    await createWebdavProvider(CFG, 'p4ss').upload(NAME, Buffer.from('x'));
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'MKCOL', 'PUT']);
    expect(calls[1].url).toBe('http://nas.local:5005/dav/athena');
  });
  it('maps 401 to a readable error', async () => {
    fakeFetch(() => new Response(null, { status: 401 }));
    await expect(createWebdavProvider(CFG, 'wrong').upload(NAME, Buffer.from('x')))
      .rejects.toThrow(/authentication failed/i);
  });
  it('lists via PROPFIND depth 1, decodes hrefs, filters foreign files', async () => {
    const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
      <d:response><d:href>/dav/athena/</d:href></d:response>
      <d:response><d:href>/dav/athena/${NAME}</d:href></d:response>
      <d:response><d:href>/dav/athena/athena-backup-2026-08-04-030000.enc.json</d:href></d:response>
      <d:response><d:href>/dav/athena/notes%20perso.txt</d:href></d:response>
    </d:multistatus>`;
    const calls = fakeFetch(() => new Response(xml, { status: 207 }));
    const names = await createWebdavProvider(CFG, 'p4ss').list();
    expect(calls[0].method).toBe('PROPFIND');
    expect(calls[0].headers.depth).toBe('1');
    expect(names).toEqual(['athena-backup-2026-08-04-030000.enc.json', NAME]);
  });
  it('an unlisted (404) directory lists as empty', async () => {
    fakeFetch(() => new Response(null, { status: 404 }));
    expect(await createWebdavProvider(CFG, 'p4ss').list()).toEqual([]);
  });
  it('remove issues DELETE and tolerates 404', async () => {
    const calls = fakeFetch(() => new Response(null, { status: 404 }));
    await createWebdavProvider(CFG, 'p4ss').remove(NAME);
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe(`http://nas.local:5005/dav/athena/${NAME}`);
  });
  it('network failure surfaces as BackupProviderError with the cause', async () => {
    __setBackupFetchForTests((async () => { throw new TypeError('fetch failed: ECONNREFUSED'); }) as typeof fetch);
    await expect(createWebdavProvider(CFG, 'p4ss').list()).rejects.toThrow(BackupProviderError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/backup-provider-webdav.test.ts`
Expected: FAIL — `createWebdavProvider` not exported.

- [ ] **Step 3: Implement** (append to `providers.ts`)

```ts
// Injectable fetch, same policy as the Enable Banking client: tests never
// touch the network.
let testFetch: typeof fetch | null = null;
export function __setBackupFetchForTests(f: typeof fetch | null): void {
  testFetch = f;
}

export function createWebdavProvider(
  cfg: { url: string; username: string; subdir: string | null },
  password: string,
): BackupProvider {
  const auth = 'Basic ' + Buffer.from(`${cfg.username}:${password}`).toString('base64');
  const base = cfg.url.replace(/\/+$/, '');
  const segments = (cfg.subdir ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(encodeURIComponent);
  const dirUrl = [base, ...segments].join('/');
  const fileUrl = (name: string) => `${dirUrl}/${encodeURIComponent(name)}`;

  async function request(method: string, url: string, extra: RequestInit = {}): Promise<Response> {
    try {
      return await (testFetch ?? fetch)(url, {
        method,
        ...extra,
        headers: { authorization: auth, ...(extra.headers as Record<string, string> | undefined) },
      });
    } catch (err) {
      throw new BackupProviderError(`webdav ${method} failed: ${errMsg(err)}`);
    }
  }

  function httpError(action: string, status: number): BackupProviderError {
    if (status === 401 || status === 403) {
      return new BackupProviderError(`webdav ${action}: authentication failed (HTTP ${status})`);
    }
    return new BackupProviderError(`webdav ${action}: HTTP ${status}`);
  }

  async function put(name: string, bytes: Buffer): Promise<Response> {
    return request('PUT', fileUrl(name), { body: new Uint8Array(bytes) });
  }

  return {
    async upload(name, bytes) {
      assertPlainName(name);
      let res = await put(name, bytes);
      if (res.status === 409 && segments.length > 0) {
        // Missing collection — create each subdir level then retry once.
        // 405 = already exists, fine.
        let url = base;
        for (const seg of segments) {
          url = `${url}/${seg}`;
          const mk = await request('MKCOL', url);
          if (!mk.ok && mk.status !== 405) throw httpError('mkcol', mk.status);
        }
        res = await put(name, bytes);
      }
      if (!res.ok) throw httpError('upload', res.status);
    },
    async list() {
      const res = await request('PROPFIND', dirUrl, { headers: { depth: '1' } });
      if (res.status === 404) return []; // nothing pushed yet
      if (!res.ok && res.status !== 207) throw httpError('list', res.status);
      const xml = await res.text();
      // Only <href> extraction is needed — no XML parser. Namespace prefix
      // varies by server (d:, D:, none), so match on the local name.
      const names: string[] = [];
      for (const m of xml.matchAll(/<[^<>]*href[^<>]*>([^<]+)<\/[^<>]*href[^<>]*>/gi)) {
        const decoded = decodeURIComponent(m[1].trim());
        const basename = decoded.split('/').filter(Boolean).pop() ?? '';
        if (isBackupFilename(basename)) names.push(basename);
      }
      return names.sort();
    },
    async remove(name) {
      assertPlainName(name);
      const res = await request('DELETE', fileUrl(name));
      if (!res.ok && res.status !== 404) throw httpError('delete', res.status);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/backup-provider-webdav.test.ts tests/backup-provider-folder.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/backup/providers.ts backend/tests/backup-provider-webdav.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(backup): WebDAV destination provider over plain fetch — PUT/MKCOL/PROPFIND/DELETE"
```

---

### Task 6: Destination store + backup runner

**Files:**
- Create: `backend/src/domain/backup/store.ts`
- Create: `backend/src/domain/backup/runner.ts`
- Test: `backend/tests/backup-runner.test.ts` (pure part, fake provider)

**Interfaces:**
- Consumes: `backupDestinations` (Task 1), `encryptSecret`/`decryptSecret`/`backupSecretsKey` (Task 2), `buildDump`/`backupFilename` (Task 3), providers (Tasks 4–5), `encryptEnvelope` from `http/routes/backup/crypto.js`.
- Produces:

```ts
// store.ts
export type WebdavConfig = { url: string; username: string; subdir: string | null; keepLast: number };
export type FolderConfig = { path: string; keepLast: number };
export type BackupDestinationRecord = {
  kind: 'webdav' | 'folder';
  config: WebdavConfig | FolderConfig;
  secret: string | null;      // decrypted WebDAV password
  passphrase: string;         // decrypted enc1 passphrase
  enabled: boolean;
  lastRunAt: Date | null;
  lastError: string | null;
};
export async function getDestination(userId: number): Promise<BackupDestinationRecord | null>;
export async function setDestination(userId: number, input: {
  kind: 'webdav' | 'folder';
  config: WebdavConfig | FolderConfig;
  secret: string | null;
  passphrase: string;
  enabled: boolean;
}): Promise<void>;                                    // upsert, onConflictDoUpdate on userId
export async function deleteDestination(userId: number): Promise<void>;
export async function recordRun(userId: number, result: { ok: true } | { ok: false; error: string }): Promise<void>;
// ok: sets lastRunAt = now, lastError = null. failure: sets lastError only
// (lastRunAt untouched → the scheduler retries next tick per the spec).
export async function listEnabledDestinations(): Promise<Array<{ userId: number; lastRunAt: Date | null }>>;

// runner.ts
export function providerFor(dest: BackupDestinationRecord): BackupProvider;
export async function uploadAndPrune(provider: BackupProvider, name: string, bytes: Buffer, keepLast: number): Promise<void>;
export class BackupNotConfiguredError extends Error {}
export async function runBackupNow(userId: number): Promise<{ filename: string }>;
// loads destination (throws BackupNotConfiguredError when absent), builds
// + seals the dump, uploads, prunes, records the run either way, rethrows
// failures.
```

Store implementation mirrors `domain/bank-sync/store.ts` field-for-field (select/insert/onConflictDoUpdate/delete, `env.SESSION_SECRET` key). `runner.ts`:

```ts
// backend/src/domain/backup/runner.ts
import { encryptEnvelope } from '../../http/routes/backup/crypto.js';
import { buildDump, backupFilename } from './dump.js';
import { createFolderProvider, createWebdavProvider, type BackupProvider } from './providers.js';
import { getDestination, recordRun, type BackupDestinationRecord, type FolderConfig, type WebdavConfig } from './store.js';

export class BackupNotConfiguredError extends Error {
  constructor() {
    super('backup destination not configured');
    this.name = 'BackupNotConfiguredError';
  }
}

export function providerFor(dest: BackupDestinationRecord): BackupProvider {
  return dest.kind === 'folder'
    ? createFolderProvider((dest.config as FolderConfig).path)
    : createWebdavProvider(dest.config as WebdavConfig, dest.secret ?? '');
}

// Upload then trim to the newest keepLast files. The stamp format sorts
// lexicographically = chronologically, and list() is pre-filtered to our
// filename pattern, so pruning can never touch a foreign file.
export async function uploadAndPrune(
  provider: BackupProvider,
  name: string,
  bytes: Buffer,
  keepLast: number,
): Promise<void> {
  await provider.upload(name, bytes);
  const names = (await provider.list()).sort();
  const excess = names.slice(0, Math.max(0, names.length - keepLast));
  for (const n of excess) await provider.remove(n);
}

export async function runBackupNow(userId: number): Promise<{ filename: string }> {
  const dest = await getDestination(userId);
  if (!dest) throw new BackupNotConfiguredError();
  try {
    const dump = await buildDump(userId);
    const envelope = encryptEnvelope(JSON.stringify(dump), dest.passphrase);
    const filename = backupFilename(new Date());
    const bytes = Buffer.from(JSON.stringify(envelope), 'utf8');
    await uploadAndPrune(providerFor(dest), filename, bytes, dest.config.keepLast);
    await recordRun(userId, { ok: true });
    return { filename };
  } catch (err) {
    await recordRun(userId, { ok: false, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
```

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/backup-runner.test.ts
import { describe, it, expect } from 'vitest';
import { uploadAndPrune } from '../src/domain/backup/runner.js';
import type { BackupProvider } from '../src/domain/backup/providers.js';

function memoryProvider(seed: string[] = []): BackupProvider & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>(seed.map((n) => [n, Buffer.from('old')]));
  return {
    files,
    async upload(name, bytes) { files.set(name, bytes); },
    async list() { return [...files.keys()].sort(); },
    async remove(name) { files.delete(name); },
  };
}

const day = (d: string) => `athena-backup-${d}-030000.enc.json`;

describe('uploadAndPrune', () => {
  it('uploads and keeps everything under the cap', async () => {
    const p = memoryProvider([day('2026-08-01')]);
    await uploadAndPrune(p, day('2026-08-02'), Buffer.from('new'), 30);
    expect([...p.files.keys()].sort()).toEqual([day('2026-08-01'), day('2026-08-02')]);
  });
  it('prunes the oldest files beyond keepLast', async () => {
    const p = memoryProvider([day('2026-08-01'), day('2026-08-02'), day('2026-08-03')]);
    await uploadAndPrune(p, day('2026-08-04'), Buffer.from('new'), 2);
    expect([...p.files.keys()].sort()).toEqual([day('2026-08-03'), day('2026-08-04')]);
  });
  it('keepLast 1 keeps exactly the file just uploaded', async () => {
    const p = memoryProvider([day('2026-08-01')]);
    await uploadAndPrune(p, day('2026-08-02'), Buffer.from('new'), 1);
    expect([...p.files.keys()]).toEqual([day('2026-08-02')]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/backup-runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `store.ts` and `runner.ts`** as specified in the Interfaces block above (store mirrors `domain/bank-sync/store.ts`; runner code given verbatim). Store's `getDestination` decrypts with field `'secret'` for `secretEncrypted` (skip when NULL) and `'passphrase'` for `passphraseEncrypted`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/backup-runner.test.ts` → PASS; `npx tsc -b` → clean. (`runBackupNow`/store get their coverage from Task 8's route tests, which exercise the real pglite rows.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/backup/store.ts backend/src/domain/backup/runner.ts backend/tests/backup-runner.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(backup): destination store (encrypted secrets) + seal-upload-prune runner"
```

---

### Task 7: Scheduler

**Files:**
- Create: `backend/src/domain/backup/scheduler.ts`
- Modify: `backend/src/buildServer.ts` (import next to line 23; call `startBackupScheduler(app);` after `startBankSyncScheduler(app);` at line 157)
- Test: `backend/tests/backup-scheduler-core.test.ts`

**Interfaces:**
- Consumes: `lastScheduledOccurrence` from `domain/imports/bank-sync-core.js`; `listEnabledDestinations`, `runBackupNow` (Task 6); `mergeSettings(...).backupHour`; `env.BACKUP_AUTO`.
- Produces: `isBackupDue(hour: number, now: Date, lastRunAt: Date | null): boolean` (pure, exported for tests); `startBackupScheduler(app: FastifyInstance): void`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/backup-scheduler-core.test.ts
import { describe, it, expect } from 'vitest';
import { isBackupDue } from '../src/domain/backup/scheduler.js';

// hour = 3 → occurrence at 03:00 local.
const at = (h: number, m = 0) => new Date(2026, 7, 5, h, m); // 2026-08-05 local

describe('isBackupDue', () => {
  it('never ran → always due', () => {
    expect(isBackupDue(3, at(4), null)).toBe(true);
  });
  it('ran after today\'s occurrence → not due', () => {
    expect(isBackupDue(3, at(9), at(3, 5))).toBe(false);
  });
  it('last success was yesterday and the hour has passed → due', () => {
    const yesterday = new Date(2026, 7, 4, 3, 5);
    expect(isBackupDue(3, at(4), yesterday)).toBe(true);
  });
  it('the hour has not come yet today and yesterday ran → not due', () => {
    const yesterday = new Date(2026, 7, 4, 3, 5);
    expect(isBackupDue(3, at(2), yesterday)).toBe(false);
  });
  it('a failed run (lastRunAt untouched) stays due on the next tick', () => {
    // failure semantics live in recordRun (lastRunAt only moves on success),
    // so dueness here is the same as "ran yesterday".
    expect(isBackupDue(3, at(4), new Date(2026, 7, 4, 3, 5))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/backup-scheduler-core.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// backend/src/domain/backup/scheduler.ts
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/client.js';
import { userSettings } from '../../db/schema.js';
import { env } from '../../env.js';
import { lastScheduledOccurrence } from '../imports/bank-sync-core.js';
import { mergeSettings } from '../settings/schema.js';
import { listEnabledDestinations } from './store.js';
import { runBackupNow } from './runner.js';

// Unattended remote backup at the user-configured local hour
// (settings.backupHour, default 03:00). Same tick pattern as the bank-sync
// scheduler: 15-min interval, boot-delayed, overlap-guarded, unref'd,
// cleared onClose, disabled with BACKUP_AUTO=0 and never active under
// tests. Dueness is persistent (backup_destinations.last_run_at, which
// only moves on success) — at most one backup per user per day, and a
// failed run retries on the next tick rather than waiting for tomorrow.
const TICK_INTERVAL_MS = 15 * 60_000;
const BOOT_DELAY_MS = 5 * 60_000;

export function isBackupDue(hour: number, now: Date, lastRunAt: Date | null): boolean {
  return (lastRunAt?.getTime() ?? 0) < lastScheduledOccurrence(hour, now).getTime();
}

async function backupHourFor(uid: number): Promise<number> {
  const [row] = await db
    .select({ settings: userSettings.settings })
    .from(userSettings)
    .where(eq(userSettings.userId, uid));
  return mergeSettings(row?.settings ?? {}).backupHour;
}

export function startBackupScheduler(app: FastifyInstance): void {
  if (env.NODE_ENV === 'test' || !env.BACKUP_AUTO) return;
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void (async () => {
      const now = new Date();
      for (const { userId, lastRunAt } of await listEnabledDestinations()) {
        if (!isBackupDue(await backupHourFor(userId), now, lastRunAt)) continue;
        try {
          const { filename } = await runBackupNow(userId);
          app.log.info(`[backup] user=${userId} pushed ${filename}`);
        } catch (err) {
          // runBackupNow already recorded lastError; keep the tick alive.
          app.log.error({ err }, `[backup] user=${userId} scheduled backup failed`);
        }
      }
    })()
      .catch((err) => app.log.error({ err }, '[backup] scheduler tick failed'))
      .finally(() => {
        running = false;
      });
  };
  const boot = setTimeout(tick, BOOT_DELAY_MS);
  boot.unref();
  const handle = setInterval(tick, TICK_INTERVAL_MS);
  handle.unref();
  app.addHook('onClose', async () => {
    clearTimeout(boot);
    clearInterval(handle);
  });
}
```

`buildServer.ts`: add `import { startBackupScheduler } from './domain/backup/scheduler.js';` next to the bank-sync import (line 23) and `startBackupScheduler(app);` right after `startBankSyncScheduler(app);` (line 157).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/backup-scheduler-core.test.ts` → PASS; `npx tsc -b` → clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/backup/scheduler.ts backend/src/buildServer.ts backend/tests/backup-scheduler-core.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(backup): nightly scheduler on the bank-sync tick pattern"
```

---

### Task 8: API routes — GET/PUT/DELETE destination + run-now

**Files:**
- Create: `backend/src/http/routes/backup/destination.ts`
- Modify: `backend/src/http/routes/backup/index.ts` (register)
- Test: `backend/tests/backup-destination-route.test.ts`

**Interfaces:**
- Consumes: store + runner (Task 6), providers (Tasks 4–5), `nextScheduledOccurrence` from `domain/imports/bank-sync-core.js`, `mergeSettings(...).backupHour`, `env.BACKUP_AUTO`, `userId(req)` from `../../plugins/auth.js`.
- Produces routes (all behind the plugin's existing `requireAuth` preHandler):
  - `GET /api/backup/destination` → unconfigured: `{ configured: false, auto: { enabled, hour, nextAt: null } }`; configured: `{ configured: true, kind, config: { url?, username?, subdir?, path?, keepLast }, enabled, lastRunAt, lastError, auto: { enabled, hour, nextAt } }` — `auto.enabled` = `env.BACKUP_AUTO && NODE_ENV !== 'test'`, `nextAt` = `nextScheduledOccurrence(hour, new Date()).toISOString()` when auto enabled AND destination enabled, else `null`. **Never** includes password or passphrase.
  - `PUT /api/backup/destination` → validates body, live-tests the destination (probe upload + remove), persists, returns the GET shape. 400 `{ error: 'invalid input', issues }` on schema failure; 502 `{ error: 'destination test failed', detail }` on probe failure.
  - `DELETE /api/backup/destination` → `{ configured: false }`.
  - `POST /api/backup/destination/run-now` → 200 `{ filename }`; 409 `{ error: 'backup destination not configured' }`; 502 `{ error: 'backup failed', detail }`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/backup-destination-route.test.ts
// requires Postgres or PGlite — run with RUN_DB_TESTS=1 (DB_DRIVER=pglite).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import { __setBackupFetchForTests } from '../src/domain/backup/providers.js';
import { decryptEnvelope, type EncryptedEnvelope } from '../src/http/routes/backup/crypto.js';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookieA: string;
let cookieB: string;
let userAId: number;
let dir: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let schema: any;

const PASSPHRASE = 'strong-backup-passphrase';
const folderPayload = (over: Record<string, unknown> = {}) => ({
  kind: 'folder', path: dir, keepLast: 30, passphrase: PASSPHRASE, ...over,
});

describe.skipIf(!RUN)('/api/backup/destination', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    ({ db } = await import('../src/db/client.js'));
    schema = await import('../src/db/schema.js');
    dir = await mkdtemp(join(tmpdir(), 'athena-dest-'));
    for (const [user, pass] of [
      ['backup-dest-a', 'backup-dest-1234'],
      ['backup-dest-b', 'backup-dest-5678'],
    ] as const) {
      const created = await app.inject({
        method: 'POST', url: '/api/onboarding/create', payload: { username: user, password: pass },
      });
      const login = await app.inject({
        method: 'POST', url: '/api/auth/login', payload: { username: user, password: pass },
      });
      const cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
      if (user === 'backup-dest-a') { cookieA = cookie; userAId = created.json().user.id; }
      else cookieB = cookie;
    }
  });

  afterAll(async () => {
    await db.delete(schema.backupDestinations).where(eq(schema.backupDestinations.userId, userAId));
    await rm(dir, { recursive: true, force: true });
    await app.close();
  });

  afterEach(() => __setBackupFetchForTests(null));

  it('requires auth on every route', async () => {
    for (const [method, url] of [
      ['GET', '/api/backup/destination'],
      ['PUT', '/api/backup/destination'],
      ['DELETE', '/api/backup/destination'],
      ['POST', '/api/backup/destination/run-now'],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    }
  });

  it('run-now without a destination is a 409', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/backup/destination/run-now', headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a relative folder path and a short passphrase with 400', async () => {
    for (const payload of [folderPayload({ path: 'relative/dir' }), folderPayload({ passphrase: 'short' })]) {
      const res = await app.inject({
        method: 'PUT', url: '/api/backup/destination', headers: { cookie: cookieA }, payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('a nonexistent folder fails the live probe with 502 and stores nothing', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/backup/destination', headers: { cookie: cookieA },
      payload: folderPayload({ path: join(dir, 'missing-mount') }),
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('destination test failed');
    const get = await app.inject({ method: 'GET', url: '/api/backup/destination', headers: { cookie: cookieA } });
    expect(get.json().configured).toBe(false);
  });

  it('stores a folder destination after a successful probe, never echoing secrets', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/backup/destination', headers: { cookie: cookieA },
      payload: folderPayload({ keepLast: 2 }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      configured: true, kind: 'folder', enabled: true,
      config: { path: dir, keepLast: 2 }, lastRunAt: null, lastError: null,
    });
    expect(res.body).not.toContain(PASSPHRASE);
    expect(res.json().auto.hour).toBe(3);
    expect(await readdir(dir)).toEqual([]); // probe file cleaned up

    // Secrets encrypted at rest.
    const rows = await db.select().from(schema.backupDestinations)
      .where(eq(schema.backupDestinations.userId, userAId));
    expect(rows).toHaveLength(1);
    expect(rows[0].passphraseEncrypted).not.toContain(PASSPHRASE);
  });

  it('run-now pushes a decryptable enc1 file and records the run', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/backup/destination/run-now', headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(200);
    const { filename } = res.json();
    expect(filename).toMatch(/^athena-backup-\d{4}-\d{2}-\d{2}-\d{6}\.enc\.json$/);
    const envelope = JSON.parse((await readFile(join(dir, filename))).toString()) as EncryptedEnvelope;
    const dump = JSON.parse(decryptEnvelope(envelope, PASSPHRASE));
    expect(dump.instance).toBe('athena-accounting');
    const get = await app.inject({ method: 'GET', url: '/api/backup/destination', headers: { cookie: cookieA } });
    expect(get.json().lastRunAt).not.toBeNull();
    expect(get.json().lastError).toBeNull();
  });

  it('run-now prunes beyond keepLast but never a foreign file', async () => {
    await writeFile(join(dir, 'athena-backup-2020-01-01-000000.enc.json'), 'old');
    await writeFile(join(dir, 'notes-perso.txt'), 'keep me');
    const res = await app.inject({
      method: 'POST', url: '/api/backup/destination/run-now', headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(200);
    const names = await readdir(dir);
    expect(names).toContain('notes-perso.txt');
    expect(names).not.toContain('athena-backup-2020-01-01-000000.enc.json'); // oldest pruned (keepLast 2)
    expect(names.filter((n) => n.startsWith('athena-backup-'))).toHaveLength(2);
  });

  it('validates a webdav destination through the injected fetch', async () => {
    const methods: string[] = [];
    __setBackupFetchForTests((async (_url: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      return new Response(null, { status: 201 });
    }) as typeof fetch);
    const res = await app.inject({
      method: 'PUT', url: '/api/backup/destination', headers: { cookie: cookieA },
      payload: {
        kind: 'webdav', url: 'http://nas.local:5005/dav', username: 'julien',
        password: 'p4ss', subdir: 'athena', keepLast: 10, passphrase: PASSPHRASE,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(methods).toEqual(['PUT', 'DELETE']); // probe write + cleanup
    expect(res.body).not.toContain('p4ss');
    // Password encrypted at rest.
    const rows = await db.select().from(schema.backupDestinations)
      .where(eq(schema.backupDestinations.userId, userAId));
    expect(rows[0].secretEncrypted).not.toContain('p4ss');
  });

  it('a webdav 401 on the probe maps to 502 with a readable detail', async () => {
    __setBackupFetchForTests((async () => new Response(null, { status: 401 })) as typeof fetch);
    const res = await app.inject({
      method: 'PUT', url: '/api/backup/destination', headers: { cookie: cookieA },
      payload: {
        kind: 'webdav', url: 'http://nas.local:5005/dav', username: 'julien',
        password: 'wrong', keepLast: 10, passphrase: PASSPHRASE,
      },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().detail).toMatch(/authentication failed/i);
  });

  it('scopes per user — user B sees unconfigured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/backup/destination', headers: { cookie: cookieB } });
    expect(res.json().configured).toBe(false);
  });

  it('DELETE removes the destination and its secrets', async () => {
    const del = await app.inject({ method: 'DELETE', url: '/api/backup/destination', headers: { cookie: cookieA } });
    expect(del.statusCode).toBe(200);
    const rows = await db.select().from(schema.backupDestinations)
      .where(eq(schema.backupDestinations.userId, userAId));
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run tests/backup-destination-route.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 3: Implement**

```ts
// backend/src/http/routes/backup/destination.ts
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { userSettings } from '../../../db/schema.js';
import { env } from '../../../env.js';
import { userId } from '../../plugins/auth.js';
import { mergeSettings } from '../../../domain/settings/schema.js';
import { nextScheduledOccurrence } from '../../../domain/imports/bank-sync-core.js';
import { BackupProviderError, type BackupProvider } from '../../../domain/backup/providers.js';
import {
  BackupNotConfiguredError,
  providerFor,
  runBackupNow,
} from '../../../domain/backup/runner.js';
import {
  deleteDestination,
  getDestination,
  setDestination,
  type BackupDestinationRecord,
  type FolderConfig,
  type WebdavConfig,
} from '../../../domain/backup/store.js';

const shared = {
  keepLast: z.number().int().min(1).max(365).default(30),
  passphrase: z.string().min(8).max(1024),
  enabled: z.boolean().default(true),
};

const PutBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('webdav'),
    url: z.string().url().refine((u) => /^https?:\/\//.test(u), { message: 'http(s) URL required' }),
    username: z.string().trim().min(1),
    password: z.string().min(1),
    subdir: z.string().trim().optional(),
    ...shared,
  }),
  z.object({
    kind: z.literal('folder'),
    path: z.string().trim().min(1).refine(isAbsolute, { message: 'absolute path required' }),
    ...shared,
  }),
]);

async function backupHourFor(uid: number): Promise<number> {
  const [row] = await db
    .select({ settings: userSettings.settings })
    .from(userSettings)
    .where(eq(userSettings.userId, uid));
  return mergeSettings(row?.settings ?? {}).backupHour;
}

async function statusFor(uid: number, dest: BackupDestinationRecord | null) {
  const hour = await backupHourFor(uid);
  const autoEnabled = env.BACKUP_AUTO && env.NODE_ENV !== 'test';
  const auto = {
    enabled: autoEnabled,
    hour,
    nextAt: autoEnabled && dest?.enabled ? nextScheduledOccurrence(hour, new Date()).toISOString() : null,
  };
  if (!dest) return { configured: false as const, auto };
  return {
    configured: true as const,
    kind: dest.kind,
    config: dest.config, // non-secret by construction (url/username/subdir/path/keepLast)
    enabled: dest.enabled,
    lastRunAt: dest.lastRunAt ? dest.lastRunAt.toISOString() : null,
    lastError: dest.lastError,
    auto,
  };
}

// Real write + delete against the destination before persisting anything —
// same philosophy as bank-sync validating credentials live. The probe name
// deliberately does NOT match the backup filename pattern, so it can never
// be counted or pruned as a backup.
async function probe(provider: BackupProvider): Promise<void> {
  const name = `.athena-destination-test-${randomUUID()}`;
  await provider.upload(name, Buffer.from('athena backup destination probe'));
  await provider.remove(name);
}

export function registerDestinationRoutes(app: FastifyInstance): void {
  app.get('/api/backup/destination', async (req: FastifyRequest) => {
    const uid = userId(req);
    return statusFor(uid, await getDestination(uid));
  });

  app.put('/api/backup/destination', async (req, reply) => {
    const parsed = PutBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const uid = userId(req);
    const body = parsed.data;
    const config: WebdavConfig | FolderConfig =
      body.kind === 'webdav'
        ? { url: body.url, username: body.username, subdir: body.subdir?.trim() || null, keepLast: body.keepLast }
        : { path: body.path, keepLast: body.keepLast };
    const secret = body.kind === 'webdav' ? body.password : null;
    const candidate: BackupDestinationRecord = {
      kind: body.kind, config, secret, passphrase: body.passphrase,
      enabled: body.enabled, lastRunAt: null, lastError: null,
    };
    try {
      await probe(providerFor(candidate));
    } catch (err) {
      const detail = err instanceof BackupProviderError ? err.message
        : err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: 'destination test failed', detail });
    }
    await setDestination(uid, {
      kind: body.kind, config, secret, passphrase: body.passphrase, enabled: body.enabled,
    });
    return statusFor(uid, await getDestination(uid));
  });

  app.delete('/api/backup/destination', async (req) => {
    await deleteDestination(userId(req));
    return { configured: false };
  });

  app.post('/api/backup/destination/run-now', async (req, reply) => {
    try {
      return await runBackupNow(userId(req));
    } catch (err) {
      if (err instanceof BackupNotConfiguredError) {
        return reply.code(409).send({ error: 'backup destination not configured' });
      }
      const detail = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: 'backup failed', detail });
    }
  });
}
```

`backup/index.ts`:
```ts
import { registerDestinationRoutes } from './destination.js';
// … inside backupRoutes(), after registerRestoreRoute(app):
registerDestinationRoutes(app);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run tests/backup-destination-route.test.ts` → PASS
Run: `cd backend && npx vitest run` → full non-DB suite green
Run: `cd backend && npx tsc -b` → clean

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/backup/destination.ts backend/src/http/routes/backup/index.ts backend/tests/backup-destination-route.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(backup): destination routes — live-probed PUT, status GET, run-now"
```

---

### Task 9: Frontend — RemoteBackupCard + lib + i18n

**Files:**
- Create: `frontend/src/pages/Data/remote-backup-lib.ts`
- Create: `frontend/src/pages/Data/RemoteBackupCard.tsx`
- Modify: `frontend/src/pages/Data/Backup.tsx` (render the card under `BackupPanel`)
- Modify: `frontend/src/locales/fr/imports.json` + `frontend/src/locales/en/imports.json` (new `backup.remote` block)
- Test: `frontend/src/pages/Data/__tests__/remote-backup-lib.test.ts`
- Test: `frontend/src/pages/Data/__tests__/RemoteBackupCard.test.tsx`

**Interfaces:**
- Consumes: `GET/PUT/DELETE /api/backup/destination`, `POST /api/backup/destination/run-now` (Task 8 shapes), `useSettings()` for `backupHour` (PATCH `/api/settings`), `api` from `api/client`, `ConfirmDialog`, `formatDateTime` from `lib/format`.
- Produces (lib):
```ts
export type RemoteBackupForm = {
  kind: 'webdav' | 'folder';
  url: string; username: string; password: string; subdir: string;
  path: string;
  keepLast: string;      // raw text-input value
  passphrase: string;
};
export type PutPayload =
  | { kind: 'webdav'; url: string; username: string; password: string; subdir?: string; keepLast: number; passphrase: string }
  | { kind: 'folder'; path: string; keepLast: number; passphrase: string };
export function buildPutPayload(form: RemoteBackupForm):
  | { ok: true; payload: PutPayload }
  | { ok: false; error: 'url' | 'username' | 'password' | 'path' | 'keepLast' | 'passphrase' };
export function isPlainHttp(url: string): boolean; // drives the LAN-cleartext warning line
```
Validation in `buildPutPayload`: `keepLast` must match `/^\d+$/` after trim with value ≥ 1 (text input + `inputMode="numeric"` — never `<input type="number">`); `passphrase` trimmed length ≥ 8; webdav needs `url` starting `http://` or `https://`, non-empty `username`/`password`; folder needs `path` starting with `/`. `subdir` omitted when blank.

- [ ] **Step 1: Write the failing lib test**

```ts
// frontend/src/pages/Data/__tests__/remote-backup-lib.test.ts
import { describe, it, expect } from 'vitest';
import { buildPutPayload, isPlainHttp, type RemoteBackupForm } from '../remote-backup-lib';

const base: RemoteBackupForm = {
  kind: 'webdav', url: 'http://nas.local:5005/dav', username: 'julien', password: 'p4ss',
  subdir: ' athena ', path: '', keepLast: '30', passphrase: 'strong-backup-passphrase',
};

describe('buildPutPayload', () => {
  it('builds a webdav payload, trimming subdir', () => {
    const r = buildPutPayload(base);
    expect(r).toEqual({
      ok: true,
      payload: {
        kind: 'webdav', url: 'http://nas.local:5005/dav', username: 'julien',
        password: 'p4ss', subdir: 'athena', keepLast: 30, passphrase: 'strong-backup-passphrase',
      },
    });
  });
  it('omits a blank subdir', () => {
    const r = buildPutPayload({ ...base, subdir: '  ' });
    expect(r.ok && !('subdir' in r.payload)).toBe(true);
  });
  it('builds a folder payload', () => {
    const r = buildPutPayload({ ...base, kind: 'folder', path: '/mnt/nas/backups' });
    expect(r).toEqual({
      ok: true,
      payload: { kind: 'folder', path: '/mnt/nas/backups', keepLast: 30, passphrase: 'strong-backup-passphrase' },
    });
  });
  it('rejects bad keepLast values', () => {
    for (const bad of ['', '0', '-3', '3.5', 'trente']) {
      expect(buildPutPayload({ ...base, keepLast: bad })).toEqual({ ok: false, error: 'keepLast' });
    }
  });
  it('rejects a short passphrase', () => {
    expect(buildPutPayload({ ...base, passphrase: 'short' })).toEqual({ ok: false, error: 'passphrase' });
  });
  it('rejects a non-http url, a blank password, a relative path', () => {
    expect(buildPutPayload({ ...base, url: 'ftp://nas' })).toEqual({ ok: false, error: 'url' });
    expect(buildPutPayload({ ...base, password: '' })).toEqual({ ok: false, error: 'password' });
    expect(buildPutPayload({ ...base, kind: 'folder', path: 'mnt/nas' })).toEqual({ ok: false, error: 'path' });
  });
});

describe('isPlainHttp', () => {
  it('flags http but not https', () => {
    expect(isPlainHttp('http://freebox.local/dav')).toBe(true);
    expect(isPlainHttp('https://cloud.example.com')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/pages/Data/__tests__/remote-backup-lib.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the lib** (pure, no React imports):

```ts
// frontend/src/pages/Data/remote-backup-lib.ts
// Pure form → wire-payload logic for the Sauvegarde distante card.

export type RemoteBackupForm = { /* as in Interfaces block */ };
export type PutPayload = { /* as in Interfaces block */ };

export function isPlainHttp(url: string): boolean {
  return /^http:\/\//i.test(url.trim());
}

export function buildPutPayload(form: RemoteBackupForm):
  | { ok: true; payload: PutPayload }
  | { ok: false; error: 'url' | 'username' | 'password' | 'path' | 'keepLast' | 'passphrase' } {
  const keepRaw = form.keepLast.trim();
  if (!/^\d+$/.test(keepRaw) || Number(keepRaw) < 1) return { ok: false, error: 'keepLast' };
  const keepLast = Number(keepRaw);
  const passphrase = form.passphrase.trim();
  if (passphrase.length < 8) return { ok: false, error: 'passphrase' };
  if (form.kind === 'folder') {
    const path = form.path.trim();
    if (!path.startsWith('/')) return { ok: false, error: 'path' };
    return { ok: true, payload: { kind: 'folder', path, keepLast, passphrase } };
  }
  const url = form.url.trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'url' };
  const username = form.username.trim();
  if (!username) return { ok: false, error: 'username' };
  if (!form.password) return { ok: false, error: 'password' };
  const subdir = form.subdir.trim();
  return {
    ok: true,
    payload: { kind: 'webdav', url, username, password: form.password, ...(subdir ? { subdir } : {}), keepLast, passphrase },
  };
}
```

Run: `npx vitest run src/pages/Data/__tests__/remote-backup-lib.test.ts` → PASS.

- [ ] **Step 4: Write the failing component test**

```tsx
// frontend/src/pages/Data/__tests__/RemoteBackupCard.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RemoteBackupCard } from '../RemoteBackupCard';
import { pinLocale } from '../../../test/i18n';

pinLocale('imports');

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

const UNCONFIGURED = { configured: false, auto: { enabled: true, hour: 3, nextAt: null } };
const CONFIGURED = {
  configured: true, kind: 'folder', enabled: true,
  config: { path: '/mnt/nas/backups', keepLast: 30 },
  lastRunAt: '2026-08-05T03:00:12Z', lastError: null,
  auto: { enabled: true, hour: 3, nextAt: '2026-08-06T03:00:00Z' },
};

function routeApi(responses: Record<string, unknown>): void {
  apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    if (key in responses) return responses[key];
    throw new Error(`no mock for ${key}`);
  });
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RemoteBackupCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiMock.mockReset());

describe('RemoteBackupCard', () => {
  it('unconfigured: shows the form; switching kind swaps the fields', async () => {
    routeApi({
      'GET /api/backup/destination': UNCONFIGURED,
      'GET /api/settings': { settings: { backupHour: 3 } },
    });
    renderCard();
    // WebDAV is the default kind — URL field visible.
    expect(await screen.findByLabelText(/URL/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /dossier/i }));
    expect(screen.getByLabelText(/chemin/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/URL/i)).not.toBeInTheDocument();
  });

  it('saving a folder destination PUTs the built payload', async () => {
    routeApi({
      'GET /api/backup/destination': UNCONFIGURED,
      'GET /api/settings': { settings: { backupHour: 3 } },
      'PUT /api/backup/destination': CONFIGURED,
    });
    renderCard();
    await userEvent.click(await screen.findByRole('radio', { name: /dossier/i }));
    await userEvent.type(screen.getByLabelText(/chemin/i), '/mnt/nas/backups');
    await userEvent.type(screen.getByLabelText(/phrase secrète/i), 'strong-backup-passphrase');
    await userEvent.click(screen.getByRole('button', { name: /tester et enregistrer/i }));
    await waitFor(() => {
      const put = apiMock.mock.calls.find(([, init]) => (init as { method?: string })?.method === 'PUT');
      expect(put).toBeDefined();
      expect((put![1] as { json: unknown }).json).toEqual({
        kind: 'folder', path: '/mnt/nas/backups', keepLast: 30, passphrase: 'strong-backup-passphrase',
      });
    });
  });

  it('configured: shows last run and fires run-now', async () => {
    routeApi({
      'GET /api/backup/destination': CONFIGURED,
      'GET /api/settings': { settings: { backupHour: 3 } },
      'POST /api/backup/destination/run-now': { filename: 'athena-backup-2026-08-05-140000.enc.json' },
    });
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: /sauvegarder maintenant/i }));
    expect(await screen.findByText(/athena-backup-2026-08-05-140000\.enc\.json/)).toBeInTheDocument();
  });

  it('surfaces lastError from the status', async () => {
    routeApi({
      'GET /api/backup/destination': { ...CONFIGURED, lastError: 'webdav upload: HTTP 401' },
      'GET /api/settings': { settings: { backupHour: 3 } },
    });
    renderCard();
    expect(await screen.findByText(/HTTP 401/)).toBeInTheDocument();
  });
});
```

Run: `cd frontend && npx vitest run src/pages/Data/__tests__/RemoteBackupCard.test.tsx` → FAIL (component missing).

- [ ] **Step 5: Implement the card**

`RemoteBackupCard.tsx` (keep under 300 lines — the lib already holds the logic):
- `useQuery({ queryKey: ['backup-destination'], queryFn: () => api('/api/backup/destination') })`.
- Form state initialised from the status when configured (`config.url/username/subdir/path/keepLast`; password + passphrase always start blank — they are never echoed).
- Kind picker: two radio inputs (WebDAV / Dossier local) — radios, not a select, so the component test's `getByRole('radio')` works.
- Fields per kind, every input a text/password input with a proper `aria-label` from i18n; `keepLast` gets `inputMode="numeric"`; when `isPlainHttp(url)` show the `httpWarning` line (payloads stay sealed; the password travels cleartext on the LAN).
- Hour picker: `<select>` 0–23 rendered `HH:00` (copy `BankSyncSchedule.tsx:26-45`), wired to `useSettings().mutation.mutate({ backupHour: Number(v) }, { onSuccess: () => qc.invalidateQueries({ queryKey: ['backup-destination'] }) })`.
- "Tester et enregistrer": `buildPutPayload(form)`; on `ok: false` set the matching localized error, else `PUT` via `useMutation` → invalidate `['backup-destination']`, clear password/passphrase fields.
- "Sauvegarder maintenant" (only when `configured`): POST run-now → show `runOk` with the filename, or the API error detail in the clay banner style (copy the banner div from `BackupPanel.tsx:162-166`).
- Status line: `lastRun` with `formatDateTime(lastRunAt)`, `nextRun` with `formatDateTime(auto.nextAt)` when present, `lastError` in clay.
- "Supprimer la destination" text-button behind a `ConfirmDialog` → DELETE → invalidate.
- Passphrase field carries the same lost-passphrase warning copy as manual export (`backup.remote.passphraseWarning`).

`Backup.tsx`: render `<RemoteBackupCard />` after the existing `<BackupPanel />` block.

i18n — `frontend/src/locales/fr/imports.json`, inside the existing `backup` object, new `remote` block (EN mirror with the same keys):
```json
"remote": {
  "sectionTitle": "Sauvegarde distante",
  "description": "Pousse automatiquement une sauvegarde chiffrée vers un serveur WebDAV (Freebox, Synology, Nextcloud…) ou un dossier local/monté.",
  "kindWebdav": "WebDAV",
  "kindFolder": "Dossier local",
  "url": "URL du serveur WebDAV",
  "username": "Utilisateur",
  "password": "Mot de passe WebDAV",
  "subdir": "Sous-dossier (optionnel)",
  "path": "Chemin absolu du dossier",
  "keepLast": "Sauvegardes conservées",
  "passphrase": "Phrase secrète de chiffrement",
  "passphraseWarning": "Sans cette phrase secrète, les sauvegardes distantes sont irrécupérables — conservez-la précieusement.",
  "httpWarning": "URL en http : le mot de passe circule en clair sur le réseau local. Le contenu des sauvegardes reste chiffré.",
  "hourLabel": "Heure de la sauvegarde",
  "save": "Tester et enregistrer",
  "saving": "Test en cours…",
  "runNow": "Sauvegarder maintenant",
  "running": "Sauvegarde en cours…",
  "runOk": "Sauvegarde envoyée : {{filename}}",
  "lastRun": "Dernière sauvegarde : {{date}}",
  "nextRun": "Prochaine sauvegarde : {{date}}",
  "neverRan": "Aucune sauvegarde envoyée pour l'instant.",
  "delete": "Supprimer la destination",
  "deleteConfirmTitle": "Supprimer la destination ?",
  "deleteConfirmDescription": "La configuration et ses secrets seront effacés. Les fichiers déjà poussés restent sur la destination.",
  "deleteConfirmLabel": "Supprimer",
  "errors": {
    "url": "URL invalide — elle doit commencer par http:// ou https://.",
    "username": "Utilisateur requis.",
    "password": "Mot de passe requis.",
    "path": "Chemin invalide — il doit être absolu (commencer par /).",
    "keepLast": "Nombre de sauvegardes invalide — entier ≥ 1.",
    "passphrase": "Phrase secrète trop courte (8 caractères minimum)."
  }
}
```

- [ ] **Step 6: Verify**

Run: `cd frontend && npx vitest run` → all green (new + existing)
Run: `cd frontend && npx tsc -b && npm run build` → clean
Run: `cd frontend && rtk proxy npx eslint src/pages/Data/RemoteBackupCard.tsx src/pages/Data/remote-backup-lib.ts` → no errors (max-lines 300 is a CI error — check the real exit output, a piped `$?` lies)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Data/RemoteBackupCard.tsx frontend/src/pages/Data/remote-backup-lib.ts \
  frontend/src/pages/Data/Backup.tsx frontend/src/pages/Data/__tests__/RemoteBackupCard.test.tsx \
  frontend/src/pages/Data/__tests__/remote-backup-lib.test.ts \
  frontend/src/locales/fr/imports.json frontend/src/locales/en/imports.json
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(backup): Sauvegarde distante card — WebDAV/folder config, run-now, schedule hour"
```

---

### Task 10: Demo mode

**Files:**
- Modify: `frontend/src/api/demo/store.ts` (optional `backupDestination` field on `DemoState`)
- Modify: `frontend/src/api/demo/handlers/reads/simple.ts` (GET destination)
- Modify: `frontend/src/api/demo/handlers/writes/settings.ts` (PUT/DELETE/run-now)
- Test: extend `frontend/src/api/demo/handlers/writes/__tests__/writes-helpers.test.ts` only if a pure helper is added; otherwise the `VITE_DEMO` build is the gate (house precedent: demo handlers are exercised by the demo build + existing handler-registration tests).

**Interfaces:**
- Consumes: `registerHandler`, `getState`/`setState`, `DemoState`.
- Produces: the demo returns a plausible fake status; PUT stores the non-secret config in demo state so the card round-trips; run-now returns a stamped fake filename; no real writes anywhere (spec §4).

- [ ] **Step 1: Implement**

`store.ts` — add to `DemoState` (optional, like `recurring`):
```ts
  // Remote-backup destination (Sauvegarde distante card). Non-secret parts
  // only — the demo never stores passwords or passphrases.
  backupDestination?: {
    kind: 'webdav' | 'folder';
    config: Record<string, unknown>;
    enabled: boolean;
    lastRunAt: string | null;
    lastError: string | null;
  };
```

`reads/simple.ts` — inside `registerSimpleHandlers()`:
```ts
  // Sauvegarde distante: plausible fake status, round-trips the writes below.
  registerHandler('GET', '/api/backup/destination', () => {
    const dest = getState().backupDestination;
    const auto = { enabled: true, hour: 3, nextAt: null as string | null };
    return dest ? { configured: true, ...dest, auto } : { configured: false, auto };
  });
```

`writes/settings.ts` — add three handlers in `registerSettingsWriteHandlers()`:
```ts
function handleDestinationPut(req: DemoRequest) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { kind, passphrase: _p, password: _w, ...config } = body;
  const dest = {
    kind: kind as 'webdav' | 'folder',
    config,
    enabled: body.enabled !== false,
    lastRunAt: null,
    lastError: null,
  };
  setState((s) => { s.backupDestination = dest; });
  return { configured: true, ...dest, auto: { enabled: true, hour: 3, nextAt: null } };
}

function handleDestinationRunNow() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `athena-backup-${stamp}.enc.json`;
  setState((s) => {
    if (s.backupDestination) s.backupDestination = { ...s.backupDestination, lastRunAt: now.toISOString() };
  });
  return { filename };
}

// registrations:
registerHandler('PUT', '/api/backup/destination', handleDestinationPut);
registerHandler('DELETE', '/api/backup/destination', () => {
  setState((s) => { delete s.backupDestination; });
  return { configured: false };
});
registerHandler('POST', '/api/backup/destination/run-now', handleDestinationRunNow);
```

- [ ] **Step 2: Verify**

Run: `cd frontend && npx vitest run` → green (demo handler-registration suites)
Run: `cd frontend && npx tsc -b && VITE_DEMO=1 npm run build && npm run build` → all clean

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/demo/store.ts frontend/src/api/demo/handlers/reads/simple.ts frontend/src/api/demo/handlers/writes/settings.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(demo): fake remote-backup destination handlers"
```

---

### Task 11: Documentation (EN + FR) + code map

**Files:**
- Modify: `docs/users/backup-recovery.md` — new `## Remote backups (scheduled)` section
- Modify: `docs/users/security-and-privacy.md` and `docs/users/encryption-at-rest.md` — one short paragraph each
- Modify: `docs/reference/api-endpoints.md` — four rows after the existing backup rows (`docs/reference/api-endpoints.md:249-250`)
- Modify: FR mirrors of all of the above under `website/i18n/fr/docusaurus-plugin-content-docs/current/` (same relative paths, section-for-section)
- Modify: `docs/reference/configuration.md` (and FR mirror) — `BACKUP_AUTO` row next to `BANK_SYNC_AUTO` (check the exact file name in the docs index; the bank-sync task added its row to "the configuration reference")
- Modify: `docs/contributors/code-map.md` — add `backend/src/domain/backup/`

**Content for `backup-recovery.md`** (write real prose; FR mirrors it header-for-header):

- `## Remote backups (scheduled)` — what it does: every night at the configured hour, Athena builds the same encrypted export and pushes it to your destination; one destination per user; files named `athena-backup-YYYY-MM-DD-HHMMSS.enc.json`; retention keeps the newest N (`keepLast`), and pruning only ever touches files matching that exact name pattern.
- `### WebDAV destination` — works with any WebDAV server; concrete pointers: Freebox (enable WebDAV in Freebox OS, `http://mafreebox.freebox.fr/…` on the LAN), Synology (WebDAV Server package, port 5005/5006), Nextcloud (`https://…/remote.php/dav/files/<user>/`). Note: with a plain-`http` URL the WebDAV password travels unencrypted on your LAN — the backup file itself is always sealed. MDX gotcha: escape literal braces if any copy uses `{date}`-style placeholders.
- `### Folder destination` — absolute path on the server (SMB/NFS mount, external disk); the folder must already exist (Athena won't create it — a missing mount must fail, not silently write locally); Docker users mount the target into the container and point the path there. Cloud without Google Drive: sync that folder with rclone or the NAS's own tooling.
- `### Schedule, retention and status` — hour picker (server local time, default 03:00), one backup per day, failed runs retry every 15 minutes until one succeeds; last-run status and errors on the card; `BACKUP_AUTO=0` disables the scheduler ("Sauvegarder maintenant" still works).
- `### Restoring from a remote copy` — download the `.enc.json` from the destination, then the normal restore flow with the same passphrase; repeat the existing lost-passphrase caution (the stored passphrase seals unattended runs — losing it makes every pushed file unreadable).

**Content for the security pages:** destination secrets (WebDAV password + backup passphrase) are AES-256-GCM-encrypted at rest under a `SESSION_SECRET`-derived key, never returned by any endpoint; every pushed dump is the standard `enc1` envelope.

**Content for `api-endpoints.md`:**

| Method | Path | Note |
|---|---|---|
| `GET` | `/api/backup/destination` | Destination status: kind, non-secret config, schedule hour, last/next run. Secrets are never echoed. |
| `PUT` | `/api/backup/destination` | Validates by a real probe write + delete against the destination before persisting; 502 with a readable detail on failure. |
| `DELETE` | `/api/backup/destination` | Removes the destination and its encrypted secrets. |
| `POST` | `/api/backup/destination/run-now` | Runs one backup immediately; returns the uploaded filename. |

- [ ] **Step 1: Write all EN sections, then the FR mirrors** (same header structure — the house convention is section-for-section parity, see `docs/users/bank-sync.md` vs its FR mirror).

- [ ] **Step 2: Verify the site builds for both locales**

Run: `cd website && npm run build`
Expected: green for `en` and `fr`.

- [ ] **Step 3: Commit**

```bash
git add docs/ website/i18n/fr/
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "docs(backup): remote destinations — user guide EN+FR, API reference, code map"
```

---

### Task 12: Final verification sweep

- [ ] Backend: `cd backend && npx vitest run` → green; `DB_DRIVER=pglite RUN_DB_TESTS=1 npx vitest run` → green (the full-DB sweep caught cross-suite issues before, e.g. shared-Postgres scoping).
- [ ] Frontend: `cd frontend && npx vitest run && npx tsc -b && npm run build && VITE_DEMO=1 npm run build` → all green.
- [ ] Lint: `cd frontend && rtk proxy npx eslint src` — confirm no max-lines error on the new files by reading the output, not `$?`.
- [ ] Grep the diff for leaks: `git log --oneline main -12` and `git diff HEAD~<n> --stat`; confirm no IP/hostname/secret landed in committed files (public-repo policy) — `nas.local` / `mafreebox.freebox.fr` in tests/docs are generic, fine.
- [ ] Do NOT push — per project policy, push only when the user asks (CI is heavy; when asked, both suites must be green first).

## Spec-coverage self-check (done at plan time)

- §1 Data model → Tasks 1 (table + `backupHour` + env) and 2/6 (encrypted secrets in store).
- §2 Providers → Tasks 3 (filename pattern), 4 (folder, atomic rename), 5 (WebDAV PUT/MKCOL/PROPFIND/DELETE, basic auth, http accepted).
- §3 Scheduler → Task 7 (tick pattern, `buildDump` shared via Task 3, one-per-day via persistent `lastRunAt`, per-user failure isolation) + Task 6 (`recordRun` semantics: failure never advances `lastRunAt` → retry next tick).
- §4 API + UI → Task 8 (four routes, live probe, secret hygiene) + Task 9 (card, kind picker, passphrase warning, hour picker, keepLast text input, both buttons, status line) + Task 10 (demo).
- §5 Tests → every task carries its own: folder temp-dir incl. atomicity + pruning (4), WebDAV fake-fetch (5), scheduler dueness (7), route PUT-failure/secret-round-trip/no-leak/run-now (8), card render/save/run-now/demo (9–10).
- §6 Documentation → Task 11 (backup-recovery, api-endpoints, security-and-privacy + encryption-at-rest, FR mirrors, code-map, `BACKUP_AUTO` config row).
