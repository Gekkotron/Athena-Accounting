# Athena MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local, encrypted MCP server that lets an LLM (e.g. Ollama via an MCP client) create/update/delete Athena transactions plus the reads needed to use them.

**Architecture:** A standalone stdio MCP server (`/mcp` package) sends each operation as `{op,args,ts}` encrypted with AES-256-GCM to a single backend endpoint `POST /api/mcp/rpc`. A valid GCM tag proves the caller holds the per-user token (no token on the wire); the backend unwraps the user's content key with a `SESSION_SECRET`-derived master key, decrypts, dispatches the operation to the *existing* transaction routes via in-process `app.inject`, and returns an encrypted `{status,body}`. Token enable/generate/revoke lives in dedicated `user_settings` columns, surfaced in the Réglages page.

**Tech Stack:** Node ≥20.11, TypeScript (ESM/NodeNext), Fastify 5, Drizzle ORM, PostgreSQL 16, Vitest, React 18 + Vite + TanStack Query, `@modelcontextprotocol/sdk`, Node built-in `crypto` (no new crypto deps).

## Global Constraints

- Node ≥ 20.11; all packages ESM (`"type": "module"`), TypeScript imports use `.js` suffixes.
- No new cryptography dependency — use Node's built-in `crypto` (`hkdfSync`, `createCipheriv`/`createDecipheriv` `aes-256-gcm`, `randomBytes`, `timingSafeEqual`).
- DB-touching backend tests are gated behind `process.env.RUN_DB_TESTS` using `describe.skipIf(!RUN)`, matching every existing route test. Pure-unit tests are ungated.
- Public-safe: no real IPs, hostnames, tokens, or secrets in code, tests, or docs — placeholders only (`<mini-pc-host>`, `EXAMPLE_TOKEN`).
- User-facing API error strings that mirror existing transaction endpoints stay in French; new operational/setup errors may be English.
- Follow existing patterns: route files export `async function xRoutes(app)`, add `app.addHook('preHandler', app.requireAuth)` for authed plugins, register in `backend/src/server.ts`.
- Crypto scheme constants are fixed and identical on both sides: HKDF salt `athena-mcp-v1` / info `content-key`; wrap salt `athena-mcp-wrap` / info `key-wrap`; AAD `athena-mcp-v1|<user>|req` and `...|res`; GCM nonce 12 bytes, tag 16 bytes; timestamp skew window 120000 ms.

---

### Task 1: Backend crypto module

**Files:**
- Create: `backend/src/domain/mcp/crypto.ts`
- Test: `backend/tests/mcp/crypto.test.ts`

**Interfaces:**
- Consumes: nothing (Node built-ins only).
- Produces:
  - `deriveContentKey(tokenBytes: Buffer): Buffer` — 32-byte key via HKDF-SHA256.
  - `masterKey(sessionSecret: string): Buffer` — 32-byte wrapping key via HKDF-SHA256.
  - `wrapKey(mk: Buffer, k: Buffer): string` — base64 `nonce(12)|ct|tag(16)`.
  - `unwrapKey(mk: Buffer, wrapped: string): Buffer` — throws on tamper.
  - `encryptEnvelope(key: Buffer, aad: string, plaintext: string): { nonce: string; ct: string }` — base64 fields; `ct` is `ciphertext|tag`.
  - `decryptEnvelope(key: Buffer, aad: string, nonce: string, ct: string): string` — throws on tamper/wrong key/AAD.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/mcp/crypto.test.ts
import { describe, it, expect } from 'vitest';
import {
  deriveContentKey, masterKey, wrapKey, unwrapKey,
  encryptEnvelope, decryptEnvelope,
} from '../../src/domain/mcp/crypto.js';

// Known-answer vector: token of 32 bytes each 0x01. Interop guarantee — the
// /mcp package tests the SAME vector, so both sides derive an identical key.
const TOKEN = Buffer.alloc(32, 0x01);
const EXPECTED_KEY_HEX =
  'REPLACE_WITH_COMPUTED_HEX'; // see Step 3 for the one-off snippet to compute

describe('mcp crypto', () => {
  it('deriveContentKey is deterministic and matches the shared vector', () => {
    const k = deriveContentKey(TOKEN);
    expect(k).toHaveLength(32);
    expect(k.toString('hex')).toBe(EXPECTED_KEY_HEX);
  });

  it('encrypt/decrypt round-trips with matching key + aad', () => {
    const k = deriveContentKey(TOKEN);
    const { nonce, ct } = encryptEnvelope(k, 'athena-mcp-v1|alice|req', '{"op":"x"}');
    expect(decryptEnvelope(k, 'athena-mcp-v1|alice|req', nonce, ct)).toBe('{"op":"x"}');
  });

  it('decrypt fails on wrong AAD (tamper detection)', () => {
    const k = deriveContentKey(TOKEN);
    const { nonce, ct } = encryptEnvelope(k, 'athena-mcp-v1|alice|req', 'hi');
    expect(() => decryptEnvelope(k, 'athena-mcp-v1|alice|res', nonce, ct)).toThrow();
  });

  it('wrap/unwrap round-trips; unwrap fails under a different master key', () => {
    const mk = masterKey('a'.repeat(32));
    const k = deriveContentKey(TOKEN);
    const wrapped = wrapKey(mk, k);
    expect(unwrapKey(mk, wrapped).equals(k)).toBe(true);
    expect(() => unwrapKey(masterKey('b'.repeat(32)), wrapped)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/mcp/crypto.test.ts`
Expected: FAIL — cannot find module `../../src/domain/mcp/crypto.js`.

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/domain/mcp/crypto.ts
import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const HKDF_SALT = 'athena-mcp-v1';
const HKDF_INFO = 'content-key';
const WRAP_SALT = 'athena-mcp-wrap';
const WRAP_INFO = 'key-wrap';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function hkdf32(ikm: Buffer, salt: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.from(salt), Buffer.from(info), 32));
}

export function deriveContentKey(tokenBytes: Buffer): Buffer {
  return hkdf32(tokenBytes, HKDF_SALT, HKDF_INFO);
}

export function masterKey(sessionSecret: string): Buffer {
  return hkdf32(Buffer.from(sessionSecret, 'utf8'), WRAP_SALT, WRAP_INFO);
}

export function wrapKey(mk: Buffer, k: Buffer): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', mk, nonce);
  const enc = Buffer.concat([cipher.update(k), cipher.final()]);
  return Buffer.concat([nonce, enc, cipher.getAuthTag()]).toString('base64');
}

export function unwrapKey(mk: Buffer, wrapped: string): Buffer {
  const buf = Buffer.from(wrapped, 'base64');
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const enc = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const d = createDecipheriv('aes-256-gcm', mk, nonce);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}

export function encryptEnvelope(key: Buffer, aad: string, plaintext: string): { nonce: string; ct: string } {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    nonce: nonce.toString('base64'),
    ct: Buffer.concat([enc, cipher.getAuthTag()]).toString('base64'),
  };
}

export function decryptEnvelope(key: Buffer, aad: string, nonce: string, ct: string): string {
  const nonceBuf = Buffer.from(nonce, 'base64');
  const buf = Buffer.from(ct, 'base64');
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const enc = buf.subarray(0, buf.length - TAG_BYTES);
  const d = createDecipheriv('aes-256-gcm', key, nonceBuf);
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
```

To fill `EXPECTED_KEY_HEX`, run this one-off and paste the output into the test:

```bash
cd backend && node --input-type=module -e "
import { hkdfSync } from 'node:crypto';
const k = Buffer.from(hkdfSync('sha256', Buffer.alloc(32,1), Buffer.from('athena-mcp-v1'), Buffer.from('content-key'), 32));
console.log(k.toString('hex'));
"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/mcp/crypto.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/mcp/crypto.ts backend/tests/mcp/crypto.test.ts
git commit -m "feat(mcp): AES-256-GCM crypto module for the MCP tunnel"
```

---

### Task 2: DB migration + schema for MCP columns

**Files:**
- Create: `backend/src/db/migrations/0016_mcp_credentials.sql`
- Modify: `backend/src/db/schema.ts` (the `userSettings` table)
- Test: `backend/tests/mcp/mcp-columns.test.ts`

**Interfaces:**
- Produces: `user_settings.mcp_enabled boolean NOT NULL DEFAULT false`, `user_settings.mcp_key_wrapped text`; Drizzle columns `userSettings.mcpEnabled`, `userSettings.mcpKeyWrapped`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/mcp/mcp-columns.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const RUN = !!process.env.RUN_DB_TESTS;

describe.skipIf(!RUN)('user_settings mcp columns', () => {
  let pool: import('pg').Pool;
  beforeAll(async () => {
    const { runMigrations } = await import('../../src/db/migrate.js');
    await runMigrations();
    const pg = (await import('pg')).default;
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => { await pool.end(); });

  it('has mcp_enabled (default false) and mcp_key_wrapped columns', async () => {
    const { rows } = await pool.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'user_settings' AND column_name IN ('mcp_enabled','mcp_key_wrapped')
      ORDER BY column_name
    `);
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(byName['mcp_enabled'].data_type).toBe('boolean');
    expect(byName['mcp_enabled'].column_default).toContain('false');
    expect(byName['mcp_key_wrapped'].is_nullable).toBe('YES');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run tests/mcp/mcp-columns.test.ts`
Expected: FAIL — columns not found (byName entries undefined).

- [ ] **Step 3: Write the migration and update the schema**

```sql
-- backend/src/db/migrations/0016_mcp_credentials.sql
-- MCP access credentials, per user. Dedicated columns (not the settings JSONB)
-- because SettingsSchema is .strict(): an unknown JSONB key would make
-- mergeSettings reject the whole blob and reset dashboard settings to defaults.
ALTER TABLE user_settings
  ADD COLUMN mcp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN mcp_key_wrapped text;
```

In `backend/src/db/schema.ts`, extend the `userSettings` table definition:

```ts
export const userSettings = pgTable('user_settings', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  settings: jsonb('settings').notNull().default({}),
  mcpEnabled: boolean('mcp_enabled').notNull().default(false),
  mcpKeyWrapped: text('mcp_key_wrapped'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Ensure `boolean` and `text` are in the existing `drizzle-orm/pg-core` import at the top of `schema.ts` (add them to the import list if missing).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run tests/mcp/mcp-columns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/0016_mcp_credentials.sql backend/src/db/schema.ts backend/tests/mcp/mcp-columns.test.ts
git commit -m "feat(mcp): user_settings columns for enable flag + wrapped key"
```

---

### Task 3: MCP settings store module

**Files:**
- Create: `backend/src/domain/mcp/store.ts`
- Test: `backend/tests/mcp/store.test.ts`

**Interfaces:**
- Consumes: `db`, `userSettings`, `users` from schema.
- Produces:
  - `getMcpState(uid: number): Promise<{ enabled: boolean; hasToken: boolean }>`
  - `setMcpEnabled(uid: number, enabled: boolean): Promise<void>`
  - `setMcpWrappedKey(uid: number, wrapped: string | null): Promise<void>`
  - `getMcpByUsername(username: string): Promise<{ userId: number; enabled: boolean; keyWrapped: string | null } | null>`

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/mcp/store.test.ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
const RUN = !!process.env.RUN_DB_TESTS;

describe.skipIf(!RUN)('mcp store', () => {
  let uid: number;
  beforeAll(async () => {
    const { runMigrations } = await import('../../src/db/migrate.js');
    await runMigrations();
    const { db } = await import('../../src/db/client.js');
    const { users } = await import('../../src/db/schema.js');
    await db.delete(users);
    const [u] = await db.insert(users).values({ username: 'storeuser', passwordHash: 'x' }).returning();
    uid = u.id;
  });
  afterEach(async () => {
    const { db } = await import('../../src/db/client.js');
    const { userSettings } = await import('../../src/db/schema.js');
    await db.delete(userSettings);
  });

  it('defaults: no row → disabled, no token', async () => {
    const s = await import('../../src/domain/mcp/store.js');
    expect(await s.getMcpState(uid)).toEqual({ enabled: false, hasToken: false });
    expect(await s.getMcpByUsername('storeuser')).toEqual({ userId: uid, enabled: false, keyWrapped: null });
  });

  it('setMcpEnabled + setMcpWrappedKey upsert and read back', async () => {
    const s = await import('../../src/domain/mcp/store.js');
    await s.setMcpEnabled(uid, true);
    await s.setMcpWrappedKey(uid, 'WRAPPED');
    expect(await s.getMcpState(uid)).toEqual({ enabled: true, hasToken: true });
    const byName = await s.getMcpByUsername('storeuser');
    expect(byName).toEqual({ userId: uid, enabled: true, keyWrapped: 'WRAPPED' });
  });

  it('setMcpWrappedKey(null) revokes', async () => {
    const s = await import('../../src/domain/mcp/store.js');
    await s.setMcpWrappedKey(uid, 'WRAPPED');
    await s.setMcpWrappedKey(uid, null);
    expect(await s.getMcpState(uid)).toEqual({ enabled: false, hasToken: false });
  });

  it('getMcpByUsername returns null for unknown user', async () => {
    const s = await import('../../src/domain/mcp/store.js');
    expect(await s.getMcpByUsername('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run tests/mcp/store.test.ts`
Expected: FAIL — cannot find module `store.js`.

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/domain/mcp/store.ts
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { userSettings, users } from '../../db/schema.js';

async function upsertMcp(uid: number, patch: { mcpEnabled?: boolean; mcpKeyWrapped?: string | null }): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId: uid, ...patch })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { ...patch, updatedAt: new Date() },
    });
}

export async function getMcpState(uid: number): Promise<{ enabled: boolean; hasToken: boolean }> {
  const [row] = await db
    .select({ enabled: userSettings.mcpEnabled, keyWrapped: userSettings.mcpKeyWrapped })
    .from(userSettings)
    .where(eq(userSettings.userId, uid));
  return { enabled: row?.enabled ?? false, hasToken: !!row?.keyWrapped };
}

export async function setMcpEnabled(uid: number, enabled: boolean): Promise<void> {
  await upsertMcp(uid, { mcpEnabled: enabled });
}

export async function setMcpWrappedKey(uid: number, wrapped: string | null): Promise<void> {
  await upsertMcp(uid, { mcpKeyWrapped: wrapped });
}

export async function getMcpByUsername(
  username: string,
): Promise<{ userId: number; enabled: boolean; keyWrapped: string | null } | null> {
  const [row] = await db
    .select({
      userId: users.id,
      enabled: userSettings.mcpEnabled,
      keyWrapped: userSettings.mcpKeyWrapped,
    })
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(eq(users.username, username));
  if (!row) return null;
  return { userId: row.userId, enabled: row.enabled ?? false, keyWrapped: row.keyWrapped ?? null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run tests/mcp/store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/mcp/store.ts backend/tests/mcp/store.test.ts
git commit -m "feat(mcp): user-settings store for enable flag + wrapped key"
```

---

### Task 4: MCP settings endpoints (enable + token lifecycle)

**Files:**
- Create: `backend/src/http/routes/mcp-settings.ts`
- Modify: `backend/src/server.ts` (register the plugin)
- Test: `backend/tests/mcp/mcp-settings-route.test.ts`

**Interfaces:**
- Consumes: `getMcpState`, `setMcpEnabled`, `setMcpWrappedKey` (Task 3); `masterKey`, `deriveContentKey`, `wrapKey` (Task 1); `env.SESSION_SECRET`.
- Produces: routes `GET /api/settings/mcp`, `PUT /api/settings/mcp`, `POST /api/settings/mcp/token`, `DELETE /api/settings/mcp/token`; exported `async function mcpSettingsRoutes(app)`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/mcp/mcp-settings-route.test.ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
const RUN = !!process.env.RUN_DB_TESTS;

describe.skipIf(!RUN)('/api/settings/mcp', () => {
  let app: FastifyInstance;
  let cookie: string;
  beforeAll(async () => {
    const { buildApp } = await import('../helpers/build-app.js');
    app = await buildApp();
    await app.inject({ method: 'POST', url: '/api/onboarding/create', payload: { username: 'mcpu', password: 'mcpu-1234' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'mcpu', password: 'mcpu-1234' } });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  });
  afterEach(async () => {
    const { db } = await import('../../src/db/client.js');
    const { userSettings } = await import('../../src/db/schema.js');
    await db.delete(userSettings);
  });

  it('requires auth', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/settings/mcp' })).statusCode).toBe(401);
  });

  it('defaults to disabled + no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/mcp', headers: { cookie } });
    expect(res.json()).toEqual({ enabled: false, hasToken: false });
  });

  it('PUT toggles enabled', async () => {
    await app.inject({ method: 'PUT', url: '/api/settings/mcp', headers: { cookie }, payload: { enabled: true } });
    const res = await app.inject({ method: 'GET', url: '/api/settings/mcp', headers: { cookie } });
    expect(res.json().enabled).toBe(true);
  });

  it('POST token returns a token once and sets hasToken', async () => {
    const gen = await app.inject({ method: 'POST', url: '/api/settings/mcp/token', headers: { cookie } });
    expect(gen.statusCode).toBe(201);
    expect(typeof gen.json().token).toBe('string');
    expect(gen.json().token.length).toBeGreaterThan(20);
    const st = await app.inject({ method: 'GET', url: '/api/settings/mcp', headers: { cookie } });
    expect(st.json().hasToken).toBe(true);
    // The raw token/hash is never echoed by GET.
    expect(JSON.stringify(st.json())).not.toContain(gen.json().token);
  });

  it('regenerating changes the token; DELETE revokes', async () => {
    const a = (await app.inject({ method: 'POST', url: '/api/settings/mcp/token', headers: { cookie } })).json().token;
    const b = (await app.inject({ method: 'POST', url: '/api/settings/mcp/token', headers: { cookie } })).json().token;
    expect(a).not.toBe(b);
    await app.inject({ method: 'DELETE', url: '/api/settings/mcp/token', headers: { cookie } });
    expect((await app.inject({ method: 'GET', url: '/api/settings/mcp', headers: { cookie } })).json().hasToken).toBe(false);
  });

  it('general GET /api/settings exposes no mcp fields', async () => {
    await app.inject({ method: 'POST', url: '/api/settings/mcp/token', headers: { cookie } });
    const res = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(Object.keys(res.json().settings).some((k) => k.toLowerCase().includes('mcp'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run tests/mcp/mcp-settings-route.test.ts`
Expected: FAIL — routes 404 (not registered).

- [ ] **Step 3: Write the route plugin and register it**

```ts
// backend/src/http/routes/mcp-settings.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { env } from '../../env.js';
import { userId } from '../plugins/auth.js';
import { getMcpState, setMcpEnabled, setMcpWrappedKey } from '../../domain/mcp/store.js';
import { masterKey, deriveContentKey, wrapKey } from '../../domain/mcp/crypto.js';

const EnableBody = z.object({ enabled: z.boolean() });

export async function mcpSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/settings/mcp', async (req) => {
    return await getMcpState(userId(req));
  });

  app.put('/api/settings/mcp', async (req, reply) => {
    const parsed = EnableBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    await setMcpEnabled(userId(req), parsed.data.enabled);
    return await getMcpState(userId(req));
  });

  // Generate a fresh token: derive the content key, wrap it under the
  // SESSION_SECRET-derived master key, store the wrapped key, and return the
  // plaintext token ONCE. Regeneration overwrites the previous wrapped key.
  app.post('/api/settings/mcp/token', async (req, reply) => {
    const token = randomBytes(32).toString('base64url');
    const k = deriveContentKey(Buffer.from(token, 'base64url'));
    const wrapped = wrapKey(masterKey(env.SESSION_SECRET), k);
    await setMcpWrappedKey(userId(req), wrapped);
    return reply.code(201).send({ token });
  });

  app.delete('/api/settings/mcp/token', async (req) => {
    await setMcpWrappedKey(userId(req), null);
    return { ok: true };
  });
}
```

In `backend/src/server.ts`: add the import near the other route imports and register it among the authenticated routes (after `settingsRoutes`):

```ts
import { mcpSettingsRoutes } from './http/routes/mcp-settings.js';
// ... within build(), after: await app.register(settingsRoutes);
await app.register(mcpSettingsRoutes);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run tests/mcp/mcp-settings-route.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/mcp-settings.ts backend/src/server.ts backend/tests/mcp/mcp-settings-route.test.ts
git commit -m "feat(mcp): settings endpoints to enable MCP and mint/revoke tokens"
```

---

### Task 5: Internal-dispatch auth branch in requireAuth

**Files:**
- Modify: `backend/src/http/plugins/auth.ts`
- Test: `backend/tests/mcp/internal-auth.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `app.internalAuthSecret: string` (per-process random hex, decorated on the instance).
  - `req.mcpUserId: number | null` (decorated request property).
  - `requireAuth` now authenticates a request carrying `x-athena-internal-auth: <internalAuthSecret>` + `x-athena-internal-uid: <uid>`.
  - `userId(req)` returns `req.session.userId ?? req.mcpUserId`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/mcp/internal-auth.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
const RUN = !!process.env.RUN_DB_TESTS;

describe.skipIf(!RUN)('internal-dispatch auth', () => {
  let app: FastifyInstance;
  let uid: number;
  beforeAll(async () => {
    const { buildApp } = await import('../helpers/build-app.js');
    app = await buildApp();
    const onboard = await app.inject({ method: 'POST', url: '/api/onboarding/create', payload: { username: 'iauth', password: 'iauth-1234' } });
    uid = onboard.json().user?.id ?? (await (async () => {
      const { db } = await import('../../src/db/client.js');
      const { users } = await import('../../src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      const [u] = await db.select().from(users).where(eq(users.username, 'iauth'));
      return u.id;
    })());
  });

  it('valid internal headers authenticate as the given uid', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/settings',
      headers: { 'x-athena-internal-auth': app.internalAuthSecret, 'x-athena-internal-uid': String(uid) },
    });
    expect(res.statusCode).toBe(200);
  });

  it('wrong internal secret is rejected (401)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/settings',
      headers: { 'x-athena-internal-auth': 'deadbeef', 'x-athena-internal-uid': String(uid) },
    });
    expect(res.statusCode).toBe(401);
  });

  it('absent internal headers are rejected (401)', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run tests/mcp/internal-auth.test.ts`
Expected: FAIL — `app.internalAuthSecret` undefined / first test not 200.

- [ ] **Step 3: Modify `auth.ts`**

Replace the body of `backend/src/http/plugins/auth.ts` with:

```ts
import type {
  FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../env.js';

declare module 'fastify' {
  interface Session { userId?: number; username?: string; }
  interface FastifyInstance {
    requireAuth: preHandlerHookHandler;
    internalAuthSecret: string;
  }
  interface FastifyRequest { mcpUserId: number | null; }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const authPlugin = fp(async function authPlugin(app: FastifyInstance) {
  await app.register(cookie);
  await app.register(session, {
    secret: env.SESSION_SECRET,
    cookieName: 'athena.sid',
    saveUninitialized: false,
    cookie: {
      secure: env.COOKIE_SECURE,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    },
  });

  // Per-process secret that only the in-process /api/mcp/rpc handler knows.
  // It lets app.inject sub-requests authenticate as a resolved user without a
  // cookie. Never persisted, logged, or sent to any external client.
  const internalAuthSecret = randomBytes(32).toString('hex');
  app.decorate('internalAuthSecret', internalAuthSecret);
  app.decorateRequest('mcpUserId', null);

  const requireAuth: preHandlerHookHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.session.userId) return;
    const secret = req.headers['x-athena-internal-auth'];
    const uidHeader = req.headers['x-athena-internal-uid'];
    if (typeof secret === 'string' && safeEqual(secret, internalAuthSecret) && typeof uidHeader === 'string') {
      const uid = Number(uidHeader);
      if (Number.isInteger(uid) && uid > 0) {
        req.mcpUserId = uid;
        return;
      }
    }
    reply.code(401).send({ error: 'authentication required' });
  };

  app.decorate('requireAuth', requireAuth);
});

export function userId(req: FastifyRequest): number {
  const id = req.session.userId ?? req.mcpUserId ?? undefined;
  if (!id) throw new Error('userId() called without an authenticated session');
  return id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run tests/mcp/internal-auth.test.ts`
Expected: PASS (3 tests).

Also run the existing auth-dependent suite to confirm no regression:
Run: `cd backend && RUN_DB_TESTS=1 npx vitest run tests/settings-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/plugins/auth.ts backend/tests/mcp/internal-auth.test.ts
git commit -m "feat(mcp): internal-dispatch auth path in requireAuth"
```

---

### Task 6: Op registry + encrypted RPC endpoint

**Files:**
- Create: `backend/src/http/routes/mcp/ops.ts`
- Create: `backend/src/http/routes/mcp/index.ts`
- Modify: `backend/src/server.ts` (register the public RPC plugin)
- Test: `backend/tests/mcp/rpc-route.test.ts`

**Interfaces:**
- Consumes: crypto (Task 1), store `getMcpByUsername` (Task 3), `app.internalAuthSecret` (Task 5), `env.SESSION_SECRET`.
- Produces:
  - `ops.ts`: `type BuiltOp = { method: 'GET'|'POST'|'PATCH'|'DELETE'; url: string; query?: Record<string,string>; payload?: unknown }`, `class UnknownOpError extends Error`, `buildOp(op: string, args: Record<string, unknown>): BuiltOp`.
  - `index.ts`: `async function mcpRpcRoutes(app)` registering `POST /api/mcp/rpc`.

- [ ] **Step 1: Write the failing tests**

```ts
// backend/tests/mcp/rpc-route.test.ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  deriveContentKey, encryptEnvelope, decryptEnvelope,
} from '../../src/domain/mcp/crypto.js';
const RUN = !!process.env.RUN_DB_TESTS;

const USER = 'rpcuser';
function aad(dir: 'req' | 'res') { return `athena-mcp-v1|${USER}|${dir}`; }

describe.skipIf(!RUN)('POST /api/mcp/rpc', () => {
  let app: FastifyInstance;
  let cookie: string;
  let key: Buffer;

  async function call(op: string, args: Record<string, unknown>, ts = Date.now()) {
    const { nonce, ct } = encryptEnvelope(key, aad('req'), JSON.stringify({ op, args, ts }));
    const res = await app.inject({ method: 'POST', url: '/api/mcp/rpc', payload: { user: USER, v: 1, nonce, ct } });
    return res;
  }
  function decode(res: { json: () => any }) {
    const body = res.json();
    return JSON.parse(decryptEnvelope(key, aad('res'), body.nonce, body.ct));
  }

  beforeAll(async () => {
    const { buildApp } = await import('../helpers/build-app.js');
    app = await buildApp();
    await app.inject({ method: 'POST', url: '/api/onboarding/create', payload: { username: USER, password: 'rpc-12345' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: USER, password: 'rpc-12345' } });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
    await app.inject({ method: 'PUT', url: '/api/settings/mcp', headers: { cookie }, payload: { enabled: true } });
    const token = (await app.inject({ method: 'POST', url: '/api/settings/mcp/token', headers: { cookie } })).json().token;
    key = deriveContentKey(Buffer.from(token, 'base64url'));
  });
  afterEach(async () => {
    const { db } = await import('../../src/db/client.js');
    const { transactions, accounts } = await import('../../src/db/schema.js');
    await db.delete(transactions);
    await db.delete(accounts);
  });

  it('create → search → update → delete round trip (all encrypted)', async () => {
    const acc = await app.inject({
      method: 'POST', url: '/api/accounts', headers: { cookie },
      payload: { name: 'RPC', type: 'courant', openingDate: '2026-01-01' },
    });
    const accountId = acc.json().account.id;

    const created = decode(await call('create_transaction', { accountId, date: '2026-02-01', amount: '-12.34', rawLabel: 'Coffee' }));
    expect(created.status).toBe(201);
    const id = created.body.transaction.id;

    const found = decode(await call('search_transactions', { search: 'Coffee' }));
    expect(found.status).toBe(200);
    expect(found.body.transactions.some((t: any) => t.id === id)).toBe(true);

    const updated = decode(await call('update_transaction', { id, notes: 'from mcp' }));
    expect(updated.status).toBe(200);
    expect(updated.body.transaction.notes).toBe('from mcp');

    const removed = decode(await call('delete_transaction', { id }));
    expect(removed.status).toBe(200);
    expect(removed.body.ok).toBe(true);
  });

  it('list_accounts and list_categories return 200 encrypted', async () => {
    expect(decode(await call('list_accounts', {})).status).toBe(200);
    expect(decode(await call('list_categories', {})).status).toBe(200);
  });

  it('unknown op → encrypted 400', async () => {
    expect(decode(await call('drop_tables', {})).status).toBe(400);
  });

  it('bad tag (wrong key) → plaintext 401', async () => {
    const wrong = deriveContentKey(Buffer.alloc(32, 9));
    const { nonce, ct } = encryptEnvelope(wrong, aad('req'), JSON.stringify({ op: 'list_accounts', args: {}, ts: Date.now() }));
    const res = await app.inject({ method: 'POST', url: '/api/mcp/rpc', payload: { user: USER, v: 1, nonce, ct } });
    expect(res.statusCode).toBe(401);
  });

  it('stale timestamp → plaintext 401', async () => {
    const res = await call('list_accounts', {}, Date.now() - 200_000);
    expect(res.statusCode).toBe(401);
  });

  it('unknown user → plaintext 401', async () => {
    const { nonce, ct } = encryptEnvelope(key, 'athena-mcp-v1|ghost|req', JSON.stringify({ op: 'list_accounts', args: {}, ts: Date.now() }));
    const res = await app.inject({ method: 'POST', url: '/api/mcp/rpc', payload: { user: 'ghost', v: 1, nonce, ct } });
    expect(res.statusCode).toBe(401);
  });

  it('disabled MCP → plaintext 401', async () => {
    await app.inject({ method: 'PUT', url: '/api/settings/mcp', headers: { cookie }, payload: { enabled: false } });
    expect((await call('list_accounts', {})).statusCode).toBe(401);
    await app.inject({ method: 'PUT', url: '/api/settings/mcp', headers: { cookie }, payload: { enabled: true } });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run tests/mcp/rpc-route.test.ts`
Expected: FAIL — `/api/mcp/rpc` 404.

- [ ] **Step 3: Write the op registry**

```ts
// backend/src/http/routes/mcp/ops.ts
export type BuiltOp = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  query?: Record<string, string>;
  payload?: unknown;
};

export class UnknownOpError extends Error {
  constructor(op: string) { super(`unknown op: ${op}`); this.name = 'UnknownOpError'; }
}

const SEARCH_KEYS = ['accountId', 'categoryId', 'sourceFileId', 'fromDate', 'toDate', 'minAmount', 'maxAmount', 'amount', 'search', 'includeTransfers', 'sort', 'order', 'limit', 'offset'] as const;

export function buildOp(op: string, args: Record<string, unknown>): BuiltOp {
  switch (op) {
    case 'list_accounts':
      return { method: 'GET', url: '/api/accounts' };
    case 'list_categories':
      return { method: 'GET', url: '/api/categories' };
    case 'search_transactions': {
      const query: Record<string, string> = {};
      for (const k of SEARCH_KEYS) {
        const v = args[k];
        if (v !== undefined && v !== null) query[k] = String(v);
      }
      return { method: 'GET', url: '/api/transactions', query };
    }
    case 'create_transaction':
      return { method: 'POST', url: '/api/transactions', payload: args };
    case 'update_transaction': {
      const { id, ...rest } = args as { id?: unknown };
      return { method: 'PATCH', url: `/api/transactions/${String(id)}`, payload: rest };
    }
    case 'delete_transaction': {
      const { id } = args as { id?: unknown };
      return { method: 'DELETE', url: `/api/transactions/${String(id)}` };
    }
    default:
      throw new UnknownOpError(op);
  }
}
```

- [ ] **Step 4: Write the RPC handler and register it**

```ts
// backend/src/http/routes/mcp/index.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../../env.js';
import {
  masterKey, unwrapKey, decryptEnvelope, encryptEnvelope,
} from '../../../domain/mcp/crypto.js';
import { getMcpByUsername } from '../../../domain/mcp/store.js';
import { buildOp, UnknownOpError } from './ops.js';

const Envelope = z.object({
  user: z.string().min(1),
  v: z.literal(1),
  nonce: z.string().min(1),
  ct: z.string().min(1),
});
const Inner = z.object({
  op: z.string().min(1),
  args: z.record(z.unknown()).default({}),
  ts: z.number(),
});
const SKEW_MS = 120_000;

export async function mcpRpcRoutes(app: FastifyInstance): Promise<void> {
  // Public route — it performs its own crypto auth. Dedicated rate limit.
  app.post('/api/mcp/rpc', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const env0 = Envelope.safeParse(req.body);
    if (!env0.success) return reply.code(400).send({ error: 'invalid envelope' });
    const { user, nonce, ct } = env0.data;

    const mcp = await getMcpByUsername(user);
    if (!mcp || !mcp.enabled || !mcp.keyWrapped) {
      return reply.code(401).send({ error: 'mcp access unavailable' });
    }

    let key: Buffer;
    let inner: z.infer<typeof Inner>;
    try {
      key = unwrapKey(masterKey(env.SESSION_SECRET), mcp.keyWrapped);
      const plaintext = decryptEnvelope(key, `athena-mcp-v1|${user}|req`, nonce, ct);
      const parsed = Inner.safeParse(JSON.parse(plaintext));
      if (!parsed.success) return reply.code(400).send({ error: 'invalid request' });
      inner = parsed.data;
    } catch {
      // Tag failure / wrong key / malformed ciphertext — do not distinguish.
      return reply.code(401).send({ error: 'authentication failed' });
    }

    if (Math.abs(Date.now() - inner.ts) > SKEW_MS) {
      return reply.code(401).send({ error: 'stale request' });
    }

    // From here, respond ENCRYPTED — including operation-level errors.
    const respond = (status: number, body: unknown) => {
      const out = encryptEnvelope(key, `athena-mcp-v1|${user}|res`, JSON.stringify({ status, body }));
      return reply.code(200).send({ v: 1, nonce: out.nonce, ct: out.ct });
    };

    let built;
    try {
      built = buildOp(inner.op, inner.args);
    } catch (err) {
      if (err instanceof UnknownOpError) return respond(400, { error: err.message });
      throw err;
    }

    const sub = await app.inject({
      method: built.method,
      url: built.url,
      query: built.query,
      payload: built.payload,
      headers: {
        'x-athena-internal-auth': app.internalAuthSecret,
        'x-athena-internal-uid': String(mcp.userId),
        ...(built.payload !== undefined ? { 'content-type': 'application/json' } : {}),
      },
    });

    let body: unknown;
    try { body = sub.json(); } catch { body = sub.body; }
    return respond(sub.statusCode, body);
  });
}
```

In `backend/src/server.ts`: import and register among the **public** routes (with the onboarding/auth registrations, before the authenticated block), because it does its own auth:

```ts
import { mcpRpcRoutes } from './http/routes/mcp/index.js';
// ... within build(), near the public routes:
await app.register(mcpRpcRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run tests/mcp/rpc-route.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/http/routes/mcp/ops.ts backend/src/http/routes/mcp/index.ts backend/src/server.ts backend/tests/mcp/rpc-route.test.ts
git commit -m "feat(mcp): encrypted RPC endpoint dispatching to existing routes"
```

---

### Task 7: MCP package scaffold + crypto (with shared vector)

**Files:**
- Create: `mcp/package.json`, `mcp/tsconfig.json`, `mcp/.gitignore`, `mcp/src/crypto.ts`
- Test: `mcp/tests/crypto.test.ts`

**Interfaces:**
- Produces (identical signatures to Task 1's client-relevant subset): `deriveContentKey`, `encryptEnvelope`, `decryptEnvelope` in `mcp/src/crypto.ts`.

- [ ] **Step 1: Scaffold the package**

```json
// mcp/package.json
{
  "name": "athena-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "athena-mcp": "dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/index.ts",
    "test": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  },
  "engines": { "node": ">=20.11" }
}
```

```json
// mcp/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src"]
}
```

```
// mcp/.gitignore
node_modules
dist
```

Then install:

```bash
cd mcp && npm install
```

Confirm the installed SDK major version and adjust the `@modelcontextprotocol/sdk` range in `package.json` if npm resolves a different major; the import paths in Task 9 assume the `1.x` layout (`@modelcontextprotocol/sdk/server/mcp.js`, `.../server/stdio.js`).

- [ ] **Step 2: Write the failing test (shared vector with the backend)**

```ts
// mcp/tests/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { deriveContentKey, encryptEnvelope, decryptEnvelope } from '../src/crypto.js';

// SAME vector as backend/tests/mcp/crypto.test.ts — proves both packages
// derive an identical content key from the same token.
const TOKEN = Buffer.alloc(32, 0x01);
const EXPECTED_KEY_HEX = 'REPLACE_WITH_SAME_HEX_AS_BACKEND';

describe('mcp package crypto', () => {
  it('derives the shared key vector', () => {
    expect(deriveContentKey(TOKEN).toString('hex')).toBe(EXPECTED_KEY_HEX);
  });
  it('round-trips its own envelope', () => {
    const k = deriveContentKey(TOKEN);
    const { nonce, ct } = encryptEnvelope(k, 'athena-mcp-v1|u|req', 'hello');
    expect(decryptEnvelope(k, 'athena-mcp-v1|u|req', nonce, ct)).toBe('hello');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mcp && npx vitest run tests/crypto.test.ts`
Expected: FAIL — cannot find `../src/crypto.js`.

- [ ] **Step 4: Write the crypto module (mirror of the backend's client-side subset)**

```ts
// mcp/src/crypto.ts
import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const HKDF_SALT = 'athena-mcp-v1';
const HKDF_INFO = 'content-key';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function deriveContentKey(tokenBytes: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', tokenBytes, Buffer.from(HKDF_SALT), Buffer.from(HKDF_INFO), 32));
}

export function encryptEnvelope(key: Buffer, aad: string, plaintext: string): { nonce: string; ct: string } {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { nonce: nonce.toString('base64'), ct: Buffer.concat([enc, cipher.getAuthTag()]).toString('base64') };
}

export function decryptEnvelope(key: Buffer, aad: string, nonce: string, ct: string): string {
  const nonceBuf = Buffer.from(nonce, 'base64');
  const buf = Buffer.from(ct, 'base64');
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const enc = buf.subarray(0, buf.length - TAG_BYTES);
  const d = createDecipheriv('aes-256-gcm', key, nonceBuf);
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
```

Set `EXPECTED_KEY_HEX` to the same value used in Task 1 (recompute with the Task 1 snippet if needed).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mcp && npx vitest run tests/crypto.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add mcp/package.json mcp/tsconfig.json mcp/.gitignore mcp/src/crypto.ts mcp/tests/crypto.test.ts mcp/package-lock.json
git commit -m "feat(mcp): scaffold /mcp package + client-side crypto (shared vector)"
```

---

### Task 8: MCP RPC client (transport + status mapping)

**Files:**
- Create: `mcp/src/config.ts`, `mcp/src/client.ts`
- Test: `mcp/tests/client.test.ts`

**Interfaces:**
- Consumes: `deriveContentKey`, `encryptEnvelope`, `decryptEnvelope` (Task 7).
- Produces:
  - `config.ts`: `loadConfig(): { apiUrl: string; user: string; token: string }` — reads `ATHENA_API_URL`, `ATHENA_MCP_USER`, `ATHENA_MCP_TOKEN`; throws a readable error listing any missing var.
  - `client.ts`: `class RpcClient { constructor(cfg, fetchImpl?); rpc(op: string, args: Record<string, unknown>): Promise<unknown> }` — encrypts, POSTs `/api/mcp/rpc`, decrypts, and on a non-2xx inner `status` throws `Error` with a mapped message; on 2xx returns the inner `body`.

- [ ] **Step 1: Write the failing test**

```ts
// mcp/tests/client.test.ts
import { describe, it, expect } from 'vitest';
import { RpcClient } from '../src/client.js';
import { deriveContentKey, encryptEnvelope, decryptEnvelope } from '../src/crypto.js';

const TOKEN = Buffer.alloc(32, 7).toString('base64url');
const cfg = { apiUrl: 'http://backend.test', user: 'u', token: TOKEN };
const key = deriveContentKey(Buffer.from(TOKEN, 'base64url'));

// A fake fetch that decrypts the request, runs `handler`, and returns an
// encrypted { status, body } response envelope.
function fakeFetch(handler: (op: string, args: any) => { status: number; body: unknown }) {
  return async (_url: string, init: any) => {
    const { user, nonce, ct } = JSON.parse(init.body);
    const inner = JSON.parse(decryptEnvelope(key, `athena-mcp-v1|${user}|req`, nonce, ct));
    const out = handler(inner.op, inner.args);
    const env = encryptEnvelope(key, `athena-mcp-v1|${user}|res`, JSON.stringify(out));
    return { ok: true, status: 200, json: async () => ({ v: 1, nonce: env.nonce, ct: env.ct }) };
  };
}

describe('RpcClient', () => {
  it('returns the inner body on 2xx', async () => {
    const c = new RpcClient(cfg, fakeFetch(() => ({ status: 200, body: { accounts: [] } })) as any);
    expect(await c.rpc('list_accounts', {})).toEqual({ accounts: [] });
  });

  it('sends encrypted requests (no plaintext op on the wire)', async () => {
    let seenBody = '';
    const spy = async (_u: string, init: any) => {
      seenBody = init.body;
      const { user, nonce, ct } = JSON.parse(init.body);
      const env = encryptEnvelope(key, `athena-mcp-v1|${user}|res`, JSON.stringify({ status: 200, body: {} }));
      return { ok: true, status: 200, json: async () => ({ v: 1, nonce: env.nonce, ct: env.ct }) };
    };
    const c = new RpcClient(cfg, spy as any);
    await c.rpc('create_transaction', { rawLabel: 'SecretMerchant' });
    expect(seenBody).not.toContain('SecretMerchant');
    expect(seenBody).not.toContain('create_transaction');
  });

  it('throws a mapped message on inner 409', async () => {
    const c = new RpcClient(cfg, fakeFetch(() => ({ status: 409, body: { error: 'doublon' } })) as any);
    await expect(c.rpc('create_transaction', {})).rejects.toThrow('doublon');
  });

  it('throws on inner 401', async () => {
    const c = new RpcClient(cfg, fakeFetch(() => ({ status: 401, body: {} })) as any);
    await expect(c.rpc('list_accounts', {})).rejects.toThrow(/disabled|invalid/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && npx vitest run tests/client.test.ts`
Expected: FAIL — cannot find `../src/client.js`.

- [ ] **Step 3: Write config + client**

```ts
// mcp/src/config.ts
export interface Config { apiUrl: string; user: string; token: string; }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = [];
  const apiUrl = env.ATHENA_API_URL ?? (missing.push('ATHENA_API_URL'), '');
  const user = env.ATHENA_MCP_USER ?? (missing.push('ATHENA_MCP_USER'), '');
  const token = env.ATHENA_MCP_TOKEN ?? (missing.push('ATHENA_MCP_TOKEN'), '');
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
  return { apiUrl: apiUrl.replace(/\/$/, ''), user, token };
}
```

```ts
// mcp/src/client.ts
import { deriveContentKey, encryptEnvelope, decryptEnvelope } from './crypto.js';
import type { Config } from './config.js';

type FetchImpl = typeof fetch;

function mapError(status: number, body: unknown): string {
  const apiMsg = (body && typeof body === 'object' && 'error' in body)
    ? String((body as { error: unknown }).error) : '';
  if (status === 401 || status === 403) return 'MCP access is disabled or the token is invalid (check Réglages → MCP)';
  if (status === 404) return apiMsg || 'transaction not found';
  if (status === 400 || status === 409) return apiMsg || `request rejected (${status})`;
  return apiMsg || `backend error ${status}`;
}

export class RpcClient {
  private key: Buffer;
  constructor(private cfg: Config, private fetchImpl: FetchImpl = fetch) {
    this.key = deriveContentKey(Buffer.from(cfg.token, 'base64url'));
  }

  async rpc(op: string, args: Record<string, unknown>): Promise<unknown> {
    const req = encryptEnvelope(this.key, `athena-mcp-v1|${this.cfg.user}|req`, JSON.stringify({ op, args, ts: Date.now() }));
    let res: Awaited<ReturnType<FetchImpl>>;
    try {
      res = await this.fetchImpl(`${this.cfg.apiUrl}/api/mcp/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: this.cfg.user, v: 1, nonce: req.nonce, ct: req.ct }),
      });
    } catch (err) {
      throw new Error(`cannot reach Athena backend at ${this.cfg.apiUrl}: ${(err as Error).message}`);
    }
    if (!res.ok) {
      // Setup/auth failures are plaintext.
      let msg = `backend error ${res.status}`;
      try { const j = await res.json() as { error?: string }; if (j?.error) msg = j.error; } catch { /* ignore */ }
      throw new Error(mapError(res.status, { error: msg }));
    }
    const envelope = await res.json() as { nonce: string; ct: string };
    const plain = JSON.parse(decryptEnvelope(this.key, `athena-mcp-v1|${this.cfg.user}|res`, envelope.nonce, envelope.ct)) as { status: number; body: unknown };
    if (plain.status < 200 || plain.status >= 300) {
      throw new Error(mapError(plain.status, plain.body));
    }
    return plain.body;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp && npx vitest run tests/client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/src/config.ts mcp/src/client.ts mcp/tests/client.test.ts
git commit -m "feat(mcp): encrypted RPC client with status→error mapping"
```

---

### Task 9: MCP tools + server bootstrap

**Files:**
- Create: `mcp/src/tools.ts`, `mcp/src/index.ts`
- Test: `mcp/tests/tools.test.ts`

**Interfaces:**
- Consumes: `RpcClient` (Task 8).
- Produces:
  - `tools.ts`: `registerTools(server, client): void` — registers the 6 tools; each tool calls `client.rpc(<op>, args)` and returns the result as MCP text content. Also exports `TOOL_SPECS` (array of `{ name, op, schema }`) so tests can assert the op mapping without an MCP server.
  - `index.ts`: bootstrap — `loadConfig()`, build `RpcClient`, create `McpServer`, `registerTools`, connect `StdioServerTransport`.

- [ ] **Step 1: Write the failing test**

```ts
// mcp/tests/tools.test.ts
import { describe, it, expect } from 'vitest';
import { TOOL_SPECS, callTool } from '../src/tools.js';

// A fake client records the (op, args) each tool forwards.
function fakeClient() {
  const calls: Array<{ op: string; args: any }> = [];
  return { calls, rpc: async (op: string, args: any) => { calls.push({ op, args }); return { ok: true }; } };
}

describe('mcp tools', () => {
  it('exposes exactly the six tools mapped to ops', () => {
    expect(TOOL_SPECS.map((t) => t.name).sort()).toEqual(
      ['create_transaction', 'delete_transaction', 'list_accounts', 'list_categories', 'search_transactions', 'update_transaction'],
    );
    for (const t of TOOL_SPECS) expect(t.op).toBe(t.name);
  });

  it('callTool forwards op + args to the client', async () => {
    const c = fakeClient();
    await callTool(c as any, 'create_transaction', { accountId: 1, date: '2026-01-01', amount: '-1.00', rawLabel: 'x' });
    expect(c.calls[0]).toEqual({ op: 'create_transaction', args: { accountId: 1, date: '2026-01-01', amount: '-1.00', rawLabel: 'x' } });
  });

  it('delete_transaction forwards the id', async () => {
    const c = fakeClient();
    await callTool(c as any, 'delete_transaction', { id: 42 });
    expect(c.calls[0]).toEqual({ op: 'delete_transaction', args: { id: 42 } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && npx vitest run tests/tools.test.ts`
Expected: FAIL — cannot find `../src/tools.js`.

- [ ] **Step 3: Write `tools.ts`**

```ts
// mcp/src/tools.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

interface RpcLike { rpc(op: string, args: Record<string, unknown>): Promise<unknown>; }

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const amountStr = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'decimal, up to 2 dp');

export const TOOL_SPECS = [
  { name: 'list_accounts', op: 'list_accounts', description: 'List accounts with balances and ids.', schema: {} },
  { name: 'list_categories', op: 'list_categories', description: 'List categories with ids and kinds.', schema: {} },
  {
    name: 'search_transactions', op: 'search_transactions',
    description: 'Search/list transactions. Use this to find a transaction id before updating or deleting.',
    schema: {
      search: z.string().optional(),
      accountId: z.number().int().positive().optional(),
      categoryId: z.number().int().positive().optional(),
      fromDate: dateStr.optional(),
      toDate: dateStr.optional(),
      amount: amountStr.optional(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    },
  },
  {
    name: 'create_transaction', op: 'create_transaction',
    description: 'Create a transaction. Negative amount = expense, positive = income.',
    schema: {
      accountId: z.number().int().positive(),
      date: dateStr,
      amount: amountStr,
      rawLabel: z.string().min(1).max(512),
      notes: z.string().max(2000).optional(),
      categoryId: z.number().int().positive().optional(),
      lockYears: z.number().int().min(0).max(99).optional(),
    },
  },
  {
    name: 'update_transaction', op: 'update_transaction',
    description: 'Update fields of an existing transaction by id.',
    schema: {
      id: z.number().int().positive(),
      accountId: z.number().int().positive().optional(),
      date: dateStr.optional(),
      amount: amountStr.optional(),
      rawLabel: z.string().min(1).max(512).optional(),
      categoryId: z.number().int().positive().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      lockYears: z.number().int().min(0).max(99).nullable().optional(),
    },
  },
  {
    name: 'delete_transaction', op: 'delete_transaction',
    description: 'Delete a transaction by id.',
    schema: { id: z.number().int().positive() },
  },
] as const;

export async function callTool(client: RpcLike, op: string, args: Record<string, unknown>): Promise<unknown> {
  return await client.rpc(op, args);
}

export function registerTools(server: McpServer, client: RpcLike): void {
  for (const spec of TOOL_SPECS) {
    server.tool(spec.name, spec.description, spec.schema as Record<string, z.ZodTypeAny>, async (args: Record<string, unknown>) => {
      try {
        const result = await callTool(client, spec.op, args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    });
  }
}
```

If `npm install` in Task 7 resolved an SDK major whose tool-registration API differs from `server.tool(name, description, zodShape, handler)`, adapt this call to that version's signature (keep `TOOL_SPECS`/`callTool` unchanged so the tests still hold).

- [ ] **Step 4: Write `index.ts`**

```ts
// mcp/src/index.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { RpcClient } from './client.js';
import { registerTools } from './tools.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const client = new RpcClient(cfg);
  const server = new McpServer({ name: 'athena-mcp', version: '0.1.0' });
  registerTools(server, client);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(`[athena-mcp] fatal: ${(err as Error).message}`);
  process.exit(1);
});
```

- [ ] **Step 5: Run tests + typecheck + build**

Run: `cd mcp && npx vitest run tests/tools.test.ts && npm run build`
Expected: tests PASS (3 tests); `tsc` produces `mcp/dist/index.js` with no type errors.

- [ ] **Step 6: Commit**

```bash
git add mcp/src/tools.ts mcp/src/index.ts mcp/tests/tools.test.ts
git commit -m "feat(mcp): six transaction tools + stdio server bootstrap"
```

---

### Task 10: Frontend Réglages "Accès MCP" card

**Files:**
- Create: `frontend/src/api/mcp.ts`
- Modify: `frontend/src/pages/Settings.tsx` (add a new `<section>` before the reset section)
- Test: `frontend/src/pages/__tests__/Settings.mcp.test.tsx`

**Interfaces:**
- Consumes: `api` from `../api/client`.
- Produces:
  - `mcp.ts`: `getMcpSettings(): Promise<{ enabled: boolean; hasToken: boolean }>`, `setMcpEnabled(enabled: boolean): Promise<{ enabled: boolean; hasToken: boolean }>`, `generateMcpToken(): Promise<{ token: string }>`, `revokeMcpToken(): Promise<{ ok: boolean }>`.
  - `Settings.tsx`: a section with `data-testid="mcp-section"`, an enable checkbox `data-testid="mcp-enable"`, a generate button `data-testid="mcp-generate"`, and a token reveal `data-testid="mcp-token"` shown once after generation.

- [ ] **Step 1: Write the failing component test**

```tsx
// frontend/src/pages/__tests__/Settings.mcp.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Settings } from '../Settings';

vi.mock('../../api/mcp', () => ({
  getMcpSettings: vi.fn().mockResolvedValue({ enabled: false, hasToken: false }),
  setMcpEnabled: vi.fn().mockResolvedValue({ enabled: true, hasToken: false }),
  generateMcpToken: vi.fn().mockResolvedValue({ token: 'EXAMPLE_TOKEN_123456789' }),
  revokeMcpToken: vi.fn().mockResolvedValue({ ok: true }),
}));

// Minimal stubs so the rest of the Settings page renders.
vi.mock('../../lib/useSettings', () => ({
  useSettings: () => ({
    settings: { dashboardRange: '3m', dashboardChartScope: 'all', chartGapThresholdDays: 6, duplicateSimilarityThreshold: 0 },
    isReady: true, patch: vi.fn(), mutation: { isSuccess: false, isError: false, data: undefined },
  }),
}));
vi.mock('../../api/client', () => ({ api: vi.fn().mockResolvedValue({ accounts: [] }) }));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Settings /></QueryClientProvider>);
}

describe('Settings — Accès MCP', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the MCP section', async () => {
    renderPage();
    expect(await screen.findByTestId('mcp-section')).toBeInTheDocument();
  });

  it('reveals a token once after generate', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('mcp-generate'));
    await waitFor(() => expect(screen.getByTestId('mcp-token')).toHaveTextContent('EXAMPLE_TOKEN_123456789'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/__tests__/Settings.mcp.test.tsx`
Expected: FAIL — `../../api/mcp` module missing / `mcp-section` not found.

- [ ] **Step 3: Write the API module**

```ts
// frontend/src/api/mcp.ts
import { api } from './client';

export function getMcpSettings() {
  return api<{ enabled: boolean; hasToken: boolean }>('/api/settings/mcp');
}
export function setMcpEnabled(enabled: boolean) {
  return api<{ enabled: boolean; hasToken: boolean }>('/api/settings/mcp', { method: 'PUT', json: { enabled } });
}
export function generateMcpToken() {
  return api<{ token: string }>('/api/settings/mcp/token', { method: 'POST' });
}
export function revokeMcpToken() {
  return api<{ ok: boolean }>('/api/settings/mcp/token', { method: 'DELETE' });
}
```

- [ ] **Step 4: Add the section to `Settings.tsx`**

Add the imports at the top:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { getMcpSettings, setMcpEnabled, generateMcpToken, revokeMcpToken } from '../api/mcp';
```

Inside the `Settings` component, before the `return`, add the MCP state + query:

```tsx
  const qc = useQueryClient();
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const mcpQ = useQuery({ queryKey: ['mcp-settings'], queryFn: getMcpSettings });
  const mcp = mcpQ.data ?? { enabled: false, hasToken: false };

  const toggleMcp = async (enabled: boolean) => {
    await setMcpEnabled(enabled);
    qc.invalidateQueries({ queryKey: ['mcp-settings'] });
  };
  const genToken = async () => {
    const { token } = await generateMcpToken();
    setFreshToken(token);
    qc.invalidateQueries({ queryKey: ['mcp-settings'] });
  };
  const revokeToken = async () => {
    await revokeMcpToken();
    setFreshToken(null);
    qc.invalidateQueries({ queryKey: ['mcp-settings'] });
  };
```

Add this `<section>` in the returned JSX, immediately before the reset `<section className="pt-4 border-t ...">`:

```tsx
        <section data-testid="mcp-section" className="flex flex-col gap-4 pt-4 border-t border-ink-800/60">
          <div>
            <h2 className="text-lg text-ink-100">Accès MCP</h2>
            <p className="text-sm text-ink-400 mt-1">
              Permet à un assistant local (Ollama via un client MCP) de gérer vos transactions.
              Le contenu est chiffré avec le jeton — rien ne circule en clair.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-200">
            <input
              data-testid="mcp-enable"
              type="checkbox"
              checked={mcp.enabled}
              onChange={(e) => void toggleMcp(e.target.checked)}
            />
            Activer l'accès MCP
          </label>
          <div className="flex items-center gap-3">
            <button
              data-testid="mcp-generate"
              type="button"
              className="btn btn-sm"
              onClick={() => void genToken()}
            >
              {mcp.hasToken ? 'Régénérer le jeton' : 'Générer un jeton'}
            </button>
            {mcp.hasToken && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void revokeToken()}>
                Révoquer
              </button>
            )}
          </div>
          {freshToken && (
            <div className="rounded-md bg-ink-900 p-3 text-sm">
              <p className="text-amber-400 mb-1">Ce jeton ne sera plus affiché — copiez-le maintenant.</p>
              <code data-testid="mcp-token" className="break-all text-ink-100">{freshToken}</code>
              <p className="text-ink-400 mt-2">
                Configurez le client MCP avec <code>ATHENA_MCP_USER</code> (votre identifiant) et
                <code> ATHENA_MCP_TOKEN</code>.
              </p>
            </div>
          )}
        </section>
```

If the `btn`/`btn-sm`/`btn-ghost` utility classes differ in this codebase, match whatever the neighboring buttons in `Settings.tsx` already use — the `data-testid`s are what the test relies on.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/__tests__/Settings.mcp.test.tsx`
Expected: PASS (2 tests).

Also run the existing Settings test to confirm no regression:
Run: `cd frontend && npx vitest run src/pages/__tests__/Settings.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/mcp.ts frontend/src/pages/Settings.tsx frontend/src/pages/__tests__/Settings.mcp.test.tsx
git commit -m "feat(mcp): Réglages card to enable MCP and mint/revoke the token"
```

---

### Task 11: Documentation

**Files:**
- Create: `docs/users/mcp.md`
- Modify: `README.md` (add a short "MCP access" subsection under Features)

**Interfaces:** none (docs only).

- [ ] **Step 1: Write `docs/users/mcp.md`**

Create `docs/users/mcp.md` covering, in order (use placeholders only — no real hosts/tokens):

1. **What it is** — a local, stdio MCP server exposing 6 transaction tools; content encrypted end-to-end with the token (AES-256-GCM); no plaintext on the LAN, TLS optional. Ollama is the model backend inside an MCP client, not an MCP client itself.
2. **Enable it** — Réglages → Accès MCP → toggle on → "Générer un jeton" → copy the token now (shown once).
3. **Build the server** — `cd mcp && npm install && npm run build`.
4. **Configure your MCP client** — example JSON for a generic client / Claude Desktop:

   ```json
   {
     "mcpServers": {
       "athena": {
         "command": "node",
         "args": ["/absolute/path/to/Athena-Accounting/mcp/dist/index.js"],
         "env": {
           "ATHENA_API_URL": "http://<mini-pc-host>:3000",
           "ATHENA_MCP_USER": "<your-athena-username>",
           "ATHENA_MCP_TOKEN": "<paste-token-here>"
         }
       }
     }
   }
   ```

5. **Use with Ollama** — note that the MCP client (e.g. `mcphost`, `oterm`) is what points at Ollama as its model; link to that client's docs; the Athena server is model-agnostic.
6. **Tools reference** — table of the 6 tools and their arguments (mirror Task 9's `TOOL_SPECS`).
7. **Security** — token is a full-CRUD credential (treat like a password); shown once; revoke/rotate in Réglages; rotating `SESSION_SECRET` invalidates the token (regenerate).

- [ ] **Step 2: Add a README subsection**

Under the Features list in `README.md`, add:

```markdown
**MCP access**

- Optional local Model Context Protocol server: let a local LLM (e.g. Ollama
  via an MCP client) create, update, delete, and search transactions. Content
  is encrypted end-to-end with a per-user token — nothing travels the LAN in
  plaintext. See [docs/users/mcp.md](docs/users/mcp.md).
```

- [ ] **Step 3: Verify links and build the docs mentally**

Run: `ls docs/users/mcp.md && grep -n "docs/users/mcp.md" README.md`
Expected: file exists; README references it.

- [ ] **Step 4: Commit**

```bash
git add docs/users/mcp.md README.md
git commit -m "docs(mcp): usage guide and README subsection"
```

---

## Final verification

- [ ] Backend unit tests (no DB): `cd backend && npx vitest run tests/mcp/crypto.test.ts`
- [ ] Backend DB tests: `cd backend && RUN_DB_TESTS=1 npx vitest run tests/mcp/` — all MCP suites pass.
- [ ] Backend full suite (regression): `cd backend && RUN_DB_TESTS=1 npx vitest run`
- [ ] MCP package: `cd mcp && npx vitest run && npm run build`
- [ ] Frontend: `cd frontend && npx vitest run src/pages/__tests__/Settings.mcp.test.tsx src/pages/__tests__/Settings.test.tsx`
- [ ] Manual smoke test (documented in `docs/users/mcp.md`): with the backend running, enable MCP + generate a token, set the three env vars, run `node mcp/dist/index.js` under an MCP client, and confirm `list_accounts` and a `create_transaction` succeed end-to-end.
