# Desktop Encryption At Rest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in password protection for the desktop app — the PGlite database runs fully in memory and the only thing on disk is an AES-256-GCM-encrypted snapshot; an unlock screen gates boot.

**Architecture:** A binary envelope module encrypts `dumpDataDir()` tarballs. A snapshot store owns atomic file swaps in `DATA_DIR`. A debounced scheduler re-snapshots after writes. On boot with the `security.json` marker present, a minimal unlock HTTP server owns the advertised port until the password decrypts the snapshot, then the real Fastify app rebinds the same port with the DB loaded in memory via `loadDataDir`. Enable/disable finalize across a restart (marker modes `encrypted` / `disable-pending`).

**Tech Stack:** Node built-in crypto (scrypt + AES-256-GCM, same parameters as `backup/crypto.ts`), PGlite `dumpDataDir`/`loadDataDir`, node:http for the unlock server, Fastify hooks, React/i18next.

## Global Constraints

- UI copy is French-first: every new i18n key gets both `frontend/src/locales/fr/*.json` and `en/*.json`.
- ESLint `max-lines` = 300 code lines per file.
- No new npm dependencies — Node built-ins and PGlite APIs only (the sidecar bundle must not grow new externals).
- Never commit IPs, hostnames, or secrets.
- Commit directly to `main` with `git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit …`. Do not push.
- The desktop entry is `backend/src/entry/tauri.ts`; the LAN entry `server.ts` must NOT gain any of this behavior (postgres driver is out of scope except the docs task).
- PGlite tests need no external services — never gate them behind `RUN_DB_TESTS`.

## Marker & file contract (used by several tasks)

In `DATA_DIR`:
- `athena.db.enc` — current encrypted snapshot (binary envelope of a gzip `dumpDataDir` tarball)
- `athena.db.enc.bak` — previous snapshot generation
- `security.json` — `{ "mode": "encrypted" }` or `{ "mode": "disable-pending" }`; absence = feature off
- `athena.db/` — the plaintext PGlite datadir; exists only when the feature is off, plus transiently between enabling and the next clean shutdown

State machine:
- **enable** (running app): live dump → encrypt → write snapshot → verify decrypt → marker `encrypted`. App keeps running on the plaintext datadir; the scheduler keeps the snapshot fresh. On clean shutdown: final snapshot, then delete `athena.db/`.
- **boot, marker `encrypted`**: unlock screen → decrypt → if `athena.db/` still exists (crash before cleanup) treat IT as truth: open it datadir-mode, dump, encrypt, delete it, then reopen in-memory from the fresh snapshot. Otherwise load snapshot in-memory directly.
- **disable** (running app): verify password → marker `disable-pending` (snapshots continue). On next boot: unlock → `PGlite.create({ dataDir, loadDataDir })` writes the plaintext datadir back → delete `athena.db.enc*` + marker → continue as a normal plaintext boot.
- **change password**: verify old against current snapshot → immediate snapshot under the new passphrase.

---

### Task 1: Binary envelope module

**Files:**
- Create: `backend/src/lib/binaryEnvelope.ts`
- Test: `backend/src/lib/__tests__/binaryEnvelope.test.ts`

**Interfaces:**
- Produces:
  - `encryptBuffer(plain: Buffer, passphrase: string): Buffer`
  - `decryptBuffer(file: Buffer, passphrase: string): Buffer` — throws `EnvelopeDecryptError` on wrong passphrase/tamper/garbage
  - `class EnvelopeDecryptError extends Error`
  - `isBinaryEnvelope(file: Buffer): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  encryptBuffer, decryptBuffer, isBinaryEnvelope, EnvelopeDecryptError,
} from '../binaryEnvelope.js';

describe('binaryEnvelope', () => {
  const plain = randomBytes(4096);

  it('roundtrips', () => {
    const file = encryptBuffer(plain, 'correct horse battery');
    expect(isBinaryEnvelope(file)).toBe(true);
    expect(decryptBuffer(file, 'correct horse battery').equals(plain)).toBe(true);
  });

  it('rejects a wrong passphrase', () => {
    const file = encryptBuffer(plain, 'right-passphrase');
    expect(() => decryptBuffer(file, 'wrong-passphrase')).toThrow(EnvelopeDecryptError);
  });

  it('rejects tampered ciphertext', () => {
    const file = encryptBuffer(plain, 'right-passphrase');
    file[file.length - 10] ^= 0xff;
    expect(() => decryptBuffer(file, 'right-passphrase')).toThrow(EnvelopeDecryptError);
  });

  it('rejects garbage input', () => {
    expect(isBinaryEnvelope(Buffer.from('not an envelope'))).toBe(false);
    expect(() => decryptBuffer(Buffer.from('not an envelope'), 'x')).toThrow(EnvelopeDecryptError);
  });
});
```

- [ ] **Step 2: Run — expect module-not-found failure**

Run: `cd backend && npx vitest run src/lib/__tests__/binaryEnvelope.test.ts`

- [ ] **Step 3: Implement**

Format: `MAGIC` (`ATHENA-DB-ENC:1\n`, ascii) + one JSON header line (`{"kdf":"scrypt","N":32768,"r":8,"p":1,"salt":"<b64>","iv":"<b64>","tag":"<b64>"}\n`) + raw ciphertext bytes. Reuse the exact scrypt parameters and maxmem handling from `backend/src/http/routes/backup/crypto.ts` (N=2^15, r=8, p=1, maxmem = 128·N·r·2, 32-byte key, 16-byte salt, 12-byte IV) — copy the constants; do not import the backup module (it is string/base64-shaped; this one is binary).

```ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const MAGIC = Buffer.from('ATHENA-DB-ENC:1\n', 'ascii');
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;

export class EnvelopeDecryptError extends Error {
  constructor() {
    super('wrong password or corrupted snapshot');
    this.name = 'EnvelopeDecryptError';
  }
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM,
  });
}

export function encryptBuffer(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const header = JSON.stringify({
    kdf: 'scrypt', N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
    salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  });
  return Buffer.concat([MAGIC, Buffer.from(header + '\n', 'utf8'), ciphertext]);
}

export function isBinaryEnvelope(file: Buffer): boolean {
  return file.length > MAGIC.length && file.subarray(0, MAGIC.length).equals(MAGIC);
}

export function decryptBuffer(file: Buffer, passphrase: string): Buffer {
  try {
    if (!isBinaryEnvelope(file)) throw new Error('bad magic');
    const nl = file.indexOf(0x0a, MAGIC.length);
    const h = JSON.parse(file.subarray(MAGIC.length, nl).toString('utf8')) as {
      N: number; r: number; p: number; salt: string; iv: string; tag: string;
    };
    const key = scryptSync(passphrase, Buffer.from(h.salt, 'base64'), 32, {
      N: h.N, r: h.r, p: h.p, maxmem: 128 * h.N * h.r * 2,
    });
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(h.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(h.tag, 'base64'));
    return Buffer.concat([decipher.update(file.subarray(nl + 1)), decipher.final()]);
  } catch {
    throw new EnvelopeDecryptError();
  }
}
```

- [ ] **Step 4: Run tests — pass; lint + tsc**
- [ ] **Step 5: Commit** — `feat(security): binary AES-256-GCM envelope for DB snapshots`

---

### Task 2: Snapshot store (atomic files + marker)

**Files:**
- Create: `backend/src/db/snapshotStore.ts`
- Test: `backend/src/db/__tests__/snapshotStore.test.ts`

**Interfaces:**
- Produces (all take `dir: string` — the DATA_DIR — as first arg so tests use temp dirs):
  - `snapshotPath(dir)` / `markerPath(dir)` helpers
  - `writeSnapshot(dir: string, file: Buffer): Promise<void>` — tmp → fsync → rotate current→`.bak` → rename tmp→current
  - `readSnapshot(dir: string): Promise<Buffer>` — throws if absent
  - `hasSnapshot(dir: string): Promise<boolean>`
  - `readMarker(dir: string): Promise<'encrypted' | 'disable-pending' | null>`
  - `writeMarker(dir: string, mode: 'encrypted' | 'disable-pending'): Promise<void>`
  - `clearEncryption(dir: string): Promise<void>` — removes snapshot, `.bak`, marker

- [ ] **Step 1: Failing tests** — cover: write→read roundtrip; second write rotates first content into `.bak`; `readMarker` on missing/garbage file returns null; `clearEncryption` removes all three; a leftover `.tmp` from a simulated interruption is ignored and overwritten by the next write. Use `mkdtemp` in `beforeEach` like `backend/src/entry/__tests__/singleInstance.test.ts` does.
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement** — plain `node:fs/promises`; `writeSnapshot` sequence:

```ts
const tmp = path.join(dir, 'athena.db.enc.tmp');
const cur = path.join(dir, 'athena.db.enc');
const bak = path.join(dir, 'athena.db.enc.bak');
const fh = await open(tmp, 'w');
try { await fh.writeFile(file); await fh.sync(); } finally { await fh.close(); }
await rm(bak, { force: true });
await rename(cur, bak).catch((e) => { if (e.code !== 'ENOENT') throw e; });
await rename(tmp, cur);
```

- [ ] **Step 4: Run tests — pass; lint + tsc.**
- [ ] **Step 5: Commit** — `feat(security): snapshot store with atomic swap and mode marker`

---

### Task 3: In-memory PGlite handoff in db/client.ts

**Files:**
- Modify: `backend/src/db/client.ts` (the `buildPglite()` function)
- Test: `backend/src/db/__tests__/clientMemoryMode.test.ts`

**Interfaces:**
- Consumes: a global set by the entry before the dynamic import chain: `globalThis.__athenaLoadDataDir: Blob | undefined`.
- Produces:
  - `buildPglite()` uses `{ loadDataDir: blob }` **without** `dataDir` when the global is set (fully in-memory), else the current `{ dataDir: env.PGLITE_PATH }`.
  - `export function getPglite(): PGliteLike | null` — the live instance (null on postgres driver); `PGliteLike` needs only `dumpDataDir(compression?: 'gzip'): Promise<Blob>`.
  - `export const dbDriver: 'pglite' | 'postgres'` (from `env.DB_DRIVER`).

- [ ] **Step 1: Failing test** — in a fresh vitest file set `process.env.DB_DRIVER = 'pglite'`, create a tiny source DB in a temp dir with a direct `new PGlite(tmp)` + `CREATE TABLE t(x int); INSERT …`, `dumpDataDir()`, close; assign the Blob to `globalThis.__athenaLoadDataDir`; then `await import('../client.js')` and assert `SELECT x FROM t` works through the exported `pool.query` and that `getPglite()` is non-null. (Env must be set before the import — client.ts reads env at module load.)
- [ ] **Step 2: Run — fail (loadDataDir path doesn't exist yet).**
- [ ] **Step 3: Implement** — inside `buildPglite()`:

```ts
const loadBlob = (globalThis as Record<string, unknown>).__athenaLoadDataDir as Blob | undefined;
const client = await PGlite.create({
  ...(loadBlob ? { loadDataDir: loadBlob } : { dataDir: env.PGLITE_PATH }),
  extensions: { pg_trgm, unaccent, pgcrypto },
});
pgliteInstance = client;
```

with module-level `let pgliteInstance: … | null = null;` and the two new exports. `dbDriver` is `env.DB_DRIVER === 'postgres' ? 'postgres' : 'pglite'`.

- [ ] **Step 4: Run new test + full backend suite — pass.**
- [ ] **Step 5: Commit** — `feat(security): PGlite can boot fully in-memory from a snapshot blob`

---

### Task 4: Snapshot scheduler + Fastify wiring + /health fields

**Files:**
- Create: `backend/src/db/snapshotScheduler.ts`
- Modify: `backend/src/buildServer.ts` (onResponse hook + `/health`)
- Test: `backend/src/db/__tests__/snapshotScheduler.test.ts`

**Interfaces:**
- Consumes: `getPglite()` (Task 3), `encryptBuffer` (Task 1), `writeSnapshot` (Task 2), `dataDir()` from `backend/src/dataDir.ts`.
- Produces:
  - `activateSnapshots(passphrase: string): void` — stores the passphrase in module memory, arms the scheduler
  - `isSnapshotActive(): boolean`
  - `markDirty(): void` — trailing 10 s debounce; coalesced; no-op when inactive
  - `snapshotNow(): Promise<void>` — dump (gzip) → encrypt → atomic write; single-flight (a call during a run queues exactly one follow-up)
  - `deactivateSnapshots(): void` (used by tests)
- `/health` returns `{ ok: true, ts, driver: dbDriver, locked: false }`.
- `buildServer` hook (after the rate-limit registration):

```ts
app.addHook('onResponse', async (req, reply) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  if (reply.statusCode >= 400) return;
  markDirty();
});
```

- [ ] **Step 1: Failing tests** — with `vi.useFakeTimers()`: `markDirty()` twice within 10 s triggers exactly one `snapshotNow`; `markDirty()` while a snapshot is in flight runs exactly one more after it settles; inactive scheduler never fires. Inject the dump/encrypt/write pipeline via a test-only `_setPipelineForTests(fn)` export so the tests need no real PGlite.
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement scheduler, wire the hook and `/health` fields.**
- [ ] **Step 4: Run scheduler tests + full backend suite (health-shape assertions in existing tests may need the two new fields) — pass.**
- [ ] **Step 5: Commit** — `feat(security): debounced encrypted snapshots after mutating requests`

---

### Task 5: Security routes (status / enable / disable / change)

**Files:**
- Create: `backend/src/http/routes/security.ts`
- Modify: `backend/src/buildServer.ts` (register the route module exactly like the existing route registrations — find the `importsRoutes`-style registration block)
- Test: `backend/tests/security-routes.pglite.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 exports, `dataDir()`, `dbDriver`, `getPglite()`.
- Produces (all under the app's auth preHandler, like other routes):
  - `GET /api/security` → `{ driver, encrypted: boolean, pendingDisable: boolean }`
  - `POST /api/security/enable { password }` (min 8, max 1024) → 400 on postgres driver or already encrypted; live `dumpDataDir('gzip')` → `encryptBuffer` → `writeSnapshot` → read back + `decryptBuffer` verify → `writeMarker('encrypted')` → `activateSnapshots(password)` → `{ ok: true }`
  - `POST /api/security/disable { password }` → 400 unless marker `encrypted`; verify password by `decryptBuffer(readSnapshot())` → `writeMarker('disable-pending')` → `{ ok: true, restartRequired: true }`
  - `POST /api/security/change { oldPassword, newPassword }` → verify old the same way → `activateSnapshots(newPassword)` → `snapshotNow()` → `{ ok: true }`
  - Wrong password anywhere → `403 { error: 'wrong password' }` (via catching `EnvelopeDecryptError`)

- [ ] **Step 1: Failing integration test** — the file sets env BEFORE importing anything:

```ts
process.env.DB_DRIVER = 'pglite';
process.env.AUTH_MODE = 'none';
process.env.SESSION_SECRET = 'x'.repeat(32);
const tmp = await mkdtemp(path.join(tmpdir(), 'athena-sec-'));
process.env.DATA_DIR = tmp;
process.env.PGLITE_PATH = path.join(tmp, 'athena.db');
const { runMigrations } = await import('../src/db/migrate.js');
const { ensureLocalUser } = await import('../src/domain/auth/localUser.js');
const { build } = await import('../src/buildServer.js');
```

Then: enable with a short password → 400; enable with a valid one → 200 and `hasSnapshot(tmp)` true and marker `encrypted`; enable again → 400; `GET /api/security` reflects state; disable with wrong password → 403; disable with right → marker `disable-pending`; change password roundtrip decrypts under the new one. Mirror the auth/inject conventions used in `backend/tests/backup-route.test.ts` (AUTH_MODE=none needs no cookie — verify by reading that file's setup).

- [ ] **Step 2: Run — fail (404).**
- [ ] **Step 3: Implement the route module + registration.**
- [ ] **Step 4: Run the new test + full backend suite — pass; lint (file under 300 lines).**
- [ ] **Step 5: Commit** — `feat(security): enable/disable/change-password API for desktop encryption`

---

### Task 6: Locked boot — unlock server + entry wiring + shutdown finalization

**Files:**
- Create: `backend/src/entry/unlockServer.ts`
- Modify: `backend/src/entry/tauri.ts`
- Test: `backend/src/entry/__tests__/unlockServer.test.ts`

**Interfaces:**
- Consumes: `readSnapshot`/`readMarker`/`writeSnapshot`/`clearEncryption` (Task 2), `decryptBuffer`/`encryptBuffer` (Task 1), `activateSnapshots`/`snapshotNow` (Task 4), `getPglite` (Task 3).
- Produces: `runUnlockServer(opts: { dir: string; port?: number }): Promise<{ port: number; passphrase: string; snapshot: Buffer }>` — binds `port ?? 0`, serves:
  - `GET /` → inline FR HTML: password form; on submit POSTs `/api/unlock`; on `{ok:true}` polls `/health` every 300 ms until it answers, then `location.reload()`
  - `GET /health` → `200 { ok: false, locked: true, driver: 'pglite' }`
  - `POST /api/unlock` `{ password }` → `decryptBuffer(readSnapshot(dir))`; wrong → `403 { error: 'wrong password' }`; right → respond `{ ok: true }`, then resolve the promise and `server.close()`
  - anything else → `423 { error: 'locked' }`

**entry/tauri.ts flow changes (after the single-instance lock, before the DB imports):**

```ts
const marker = await readMarker(dir);
let unlockedPort: number | undefined;
if (marker !== null) {
  const unlock = await runUnlockServer({ dir });
  process.stdout.write(`ATHENA_PORT=${unlock.port}\n`);        // shell contract
  await writeFile(portFile, `${unlock.port}\n`, { mode: 0o600 });
  unlockedPort = unlock.port;

  if (marker === 'disable-pending') {
    // Materialize the plaintext datadir, drop encryption, continue normal boot.
    const { PGlite } = await import('@electric-sql/pglite');
    const back = await PGlite.create({
      dataDir: process.env.PGLITE_PATH!,
      loadDataDir: new Blob([unlock.snapshot]),
    });
    await back.close();
    await clearEncryption(dir);
  } else {
    // marker === 'encrypted'
    if (existsSync(process.env.PGLITE_PATH!)) {
      // Crash before the plaintext cleanup: the datadir is fresher than the
      // snapshot. Re-snapshot from it, then remove it.
      const { PGlite } = await import('@electric-sql/pglite');
      const p = await PGlite.create({ dataDir: process.env.PGLITE_PATH! });
      const dump = Buffer.from(await (await p.dumpDataDir('gzip')).arrayBuffer());
      await p.close();
      await writeSnapshot(dir, encryptBuffer(dump, unlock.passphrase));
      await rm(process.env.PGLITE_PATH!, { recursive: true, force: true });
      (globalThis as Record<string, unknown>).__athenaLoadDataDir = new Blob([dump]);
    } else {
      (globalThis as Record<string, unknown>).__athenaLoadDataDir =
        new Blob([decryptBuffer(await readSnapshot(dir), unlock.passphrase)]);
    }
    activateSnapshots(unlock.passphrase);   // safe: module holds state until the dynamic imports wire it
  }
}
```

Note: `activateSnapshots` lives in a module imported both here and by `buildServer` — a plain static import in tauri.ts is fine (it does not import the DB).

Then the existing dynamic-import boot runs unchanged, except `app.listen` uses `{ host: '127.0.0.1', port: unlockedPort ?? 0 }` with a rebind retry when `unlockedPort` is set:

```ts
let address: string | undefined;
for (let i = 0; i < 25; i++) {
  try {
    address = await app.listen({ host: '127.0.0.1', port: unlockedPort ?? 0 });
    break;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || unlockedPort === undefined) throw err;
    await new Promise((r) => setTimeout(r, 200));
  }
}
if (!address) throw new Error('could not rebind the unlock port');
```

Print `ATHENA_PORT` only when it was NOT already printed by the unlock phase.

**Shutdown additions** (inside the existing `shutdown()` before `app.close()`): if `isSnapshotActive()`: `await snapshotNow()`; then if marker is `encrypted` and the plaintext datadir still exists (the enable-migration case): `await rm(PGLITE_PATH, { recursive: true, force: true })`.

- [ ] **Step 1: Failing unlockServer unit test** — build a fixture: temp dir, `writeSnapshot(dir, encryptBuffer(Buffer.from('fixture'), 'pw-123456'))`, `writeMarker(dir, 'encrypted')`; start `runUnlockServer`; assert `GET /health` says locked; `POST /api/unlock` wrong pw → 403 and promise still pending; right pw → 200, promise resolves with the plaintext and a closed server (subsequent fetch rejects).
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement `unlockServer.ts` (node:http, no Fastify) and the tauri.ts wiring above.**
- [ ] **Step 4: Run unit test + `npx tsc --noEmit` + full backend suite — pass.**
- [ ] **Step 5: Commit** — `feat(security): locked boot — unlock server, in-memory load, crash finalization`

---

### Task 7: Frontend — Settings → Sécurité panel

**Files:**
- Create: `frontend/src/pages/SettingsSecurity.tsx` (rendered from `Settings.tsx`; keep `Settings.tsx` under max-lines by importing the panel)
- Modify: `frontend/src/pages/Settings.tsx` (add the section)
- Modify: `frontend/src/locales/fr/settings.json`, `frontend/src/locales/en/settings.json`
- Test: `frontend/src/pages/__tests__/SettingsSecurity.test.tsx`

**Interfaces:**
- Consumes: `GET /api/security` → `{ driver, encrypted, pendingDisable }`; the three POST endpoints from Task 5; `api()` client from `frontend/src/api/client.ts`.
- Produces: a `<SettingsSecurity />` section that:
  - on `driver === 'postgres'`: renders one paragraph pointing to `docs/users/encryption-at-rest.md` (i18n key `security.postgresPointer`)
  - `encrypted === false`: password + confirm fields (both `type="password"`, min 8, must match), a red warning block (`security.noRecoveryWarning`: FR copy must state plainly that a forgotten password means the data is unrecoverable without a backup), and an enable button
  - `encrypted === true`: change-password form (old + new + confirm) and a disable form (password + destructive-styled button + note that it takes effect at next launch, `security.disablePending` shown when `pendingDisable`)
  - errors from 403 render `security.wrongPassword`

- [ ] **Step 1: Failing tests** — mock `api` (follow the mocking convention used by existing Settings tests — read `frontend/src/pages/__tests__/` first): enable button disabled until both fields match and are ≥ 8; wrong-password 403 shows the error string; postgres driver shows the pointer paragraph and no forms.
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement panel + section + i18n keys (write full FR and EN copy in this step, no placeholders — draft FR first, EN mirrors it).**
- [ ] **Step 4: Run new tests + full frontend suite + `npx tsc --noEmit` + eslint — pass.**
- [ ] **Step 5: Commit** — `feat(security): Settings panel for desktop encryption (enable/change/disable)`

---

### Task 8: Docs — encryption at rest (desktop + Docker volume encryption)

**Files:**
- Create: `docs/users/encryption-at-rest.md`
- Modify: `docs/users/` index/README if one lists user docs (check `docs/users/` for an index pattern); `README.md` security bullet if it mentions backups (verify with `grep -n "chiffr\|encrypt" README.md`)

**Interfaces:**
- Consumes: final UI behavior from Task 7 (screenshots optional, text-only fine).

- [ ] **Step 1: Write the doc** with these sections (FR-style user docs — check the language of existing `docs/users/*.md` first and match it):
  1. **Desktop**: what enabling does (in-memory DB + encrypted snapshot, plaintext never on disk), the no-recovery rule, the ~10 s crash window, how to change/disable.
  2. **Docker/LAN**: the app does NOT encrypt Postgres files; anyone with Docker/root access can read them. Recommended setup on a Linux host: LUKS volume (`cryptsetup luksFormat` → mount at e.g. `/mnt/encrypted`) or an encrypted ZFS/Btrfs dataset, then point the compose bind mount there. Include a `docker-compose.override.yml` example:

```yaml
services:
  db:
    volumes:
      - /mnt/encrypted/athena-postgres:/var/lib/postgresql/data
```

  3. **Threat model table**: laptop/host stolen while off → protected (both modes); live host with root/Docker access → NOT protected (either mode); passphrase lost → desktop data unrecoverable / LUKS volume unrecoverable.
- [ ] **Step 2: Lint the repo docs build if one exists (check `.github/workflows/docs.yml` for the build command) — pass.**
- [ ] **Step 3: Commit** — `docs(security): encryption at rest — desktop model + Docker volume encryption guide`

---

### Task 9: End-to-end desktop smoke script

**Files:**
- Create: `desktop/scripts/smoke-encryption.sh` (dev tool, committed)

**Interfaces:**
- Consumes: the whole feature; `node --import tsx backend/src/entry/tauri.ts` as the sidecar stand-in.

- [ ] **Step 1: Write the script** — temp `DATA_DIR`; boot sidecar (background, from `backend/`); wait for `ATHENA_PORT`; seed one account via `POST /api/accounts`; `POST /api/security/enable {"password":"smoke-pass-123"}`; assert `athena.db.enc` exists; SIGTERM the sidecar and assert the plaintext `athena.db/` directory is GONE; boot again; assert `GET /health` says `locked: true`; `POST /api/unlock` with the wrong then right password; after reload window, assert the seeded account is returned by `GET /api/accounts`; `POST /api/security/disable` + restart; assert plaintext dir is back and `athena.db.enc` gone. Print PASS/FAIL per stage; exit non-zero on any failure. Model the process handling on `desktop/scripts/` conventions and the port-grep pattern from `build-sidecar.mjs`'s smoke-test note.
- [ ] **Step 2: Run it — all stages PASS.**
- [ ] **Step 3: Commit** — `test(security): desktop encryption smoke script`

---

## Self-review notes

- Spec coverage: storage format (T1/T2), runtime flow + unlock + rebind (T6), scheduler + dirty hook (T4), enable/disable/change (T5), health fields (T4), frontend panel + i18n (T7), Docker docs (T8), crash finalization (T6), tests throughout, e2e (T9). The spec's "423 routes the SPA to the unlock screen" is intentionally simplified: while locked, the unlock server owns the port and the SPA is never loaded, so the SPA needs no 423 handling — the unlock page itself handles the transition. This deviation is recorded here.
- Type consistency: `runUnlockServer` resolves `{ port, passphrase, snapshot }`; `activateSnapshots(passphrase)`; `writeSnapshot(dir, file)`; `decryptBuffer(file, passphrase)` — names match across tasks.
