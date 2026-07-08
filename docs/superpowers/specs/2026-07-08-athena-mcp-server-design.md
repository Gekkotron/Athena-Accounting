# Athena MCP Server — Design

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation plan

## Goal

Expose Athena's transaction operations (add / update / remove, plus the reads
needed to use them) over the Model Context Protocol, so a local LLM — e.g. an
Ollama model driven through an MCP client on the user's Mac — can manage
transactions. Everything stays local, and **nothing sensitive travels the LAN
in plaintext**: all content is encrypted end-to-end with a key derived from a
per-user token, without requiring TLS/certs.

## Constraints & context

- **Reuse, don't reimplement.** The Fastify backend already has a complete,
  authenticated transaction API. The MCP server drives that logic; it never
  touches PostgreSQL directly. This inherits, for free, the invariants the API
  enforces: dedup (`UNIQUE(account_id, dedup_key)`), the auto-categorization
  rule engine, transfer-leg unlinking on delete, and the split-amount DB
  trigger.
- **Ollama is a model backend, not an MCP client.** Ollama itself does not
  speak MCP. What we build is a standard, model-agnostic MCP server; wiring it
  to Ollama is done inside an MCP client (mcphost, Claude Desktop, oterm, …)
  and is documented, not coded.
- **No plaintext on the wire.** Content confidentiality is provided at the
  application layer with AES-256-GCM keyed by the token. TLS is not required.
- **Public-safe.** The project is going public. Committed docs and tests use
  placeholder hosts/tokens only — no real IPs, hostnames, or secrets.
- **Single-user in practice.** The `users` table is multi-user-capable, but
  onboarding + the anti-takeover lock mean one user. The token resolves to a
  real user id, so all existing per-user scoping applies unchanged.

## Data flow

```
Ollama-backed MCP client (Mac: mcphost / Claude Desktop / oterm)
        │ stdio (MCP)
        ▼
Athena MCP server (node, launched by the client)
        │  env: ATHENA_API_URL, ATHENA_MCP_USER, ATHENA_MCP_TOKEN
        │  derives K = HKDF(token); encrypts {op,args,ts} with AES-256-GCM
        ▼
POST /api/mcp/rpc  { user, v, nonce, ct }        (over the LAN — ciphertext only)
        ▼
Fastify backend (mini-PC)
        │  look up user → unwrap that user's K with the master key
        │  decrypt+verify (valid GCM tag == proof the caller holds the token)
        │  map op → (method, path); app.inject the existing route as this user
        ▼
existing /api/transactions, /api/accounts, /api/categories handlers
        ▼
PostgreSQL
        ▲
        │  encrypt { status, body } with K → { v, nonce, ct }
        ▼
back to the MCP server, which decrypts and returns the tool result
```

## Cryptographic design

### Token and keys

- **Token:** 32 random bytes (`crypto.randomBytes(32)`), presented to the user
  as base64url. Shown **once**, at generation. It is the shared secret between
  the MCP server (env) and the backend (stored wrapped).
- **Content key `K`:** `HKDF-SHA256(ikm = tokenBytes, salt = "athena-mcp-v1",
  info = "content-key", length = 32)`. Both sides derive the same `K` from the
  token. The MCP server derives it at runtime from `ATHENA_MCP_TOKEN`. The
  backend derives it **once at token generation**, then stores it wrapped and
  discards the token.
- **Master key (server-side wrapping key):** `HKDF-SHA256(ikm = SESSION_SECRET,
  salt = "athena-mcp-wrap", info = "key-wrap", length = 32)`. Reuses the
  already-required `SESSION_SECRET`; no new required env var.
- **Wrapped key at rest:** `mcpKeyWrapped = base64(nonce(12) || AES-256-GCM(
  masterKey, K) || tag)`, stored in the `user_settings.mcp_key_wrapped` column.

Why wrapped rather than a one-way hash: symmetric content encryption requires
the backend to recover `K`, which a hash cannot provide. Wrapping keeps `K`
out of plaintext at rest while still recoverable with the master key. This is
the deliberate trade-off accepted for "encrypt with the token"; the token
itself is still shown only once and never stored.

### Wire envelope

Request body to `POST /api/mcp/rpc`:
```json
{ "user": "<username>", "v": 1, "nonce": "<b64 12 bytes>", "ct": "<b64 ciphertext+tag>" }
```
- AAD = `"athena-mcp-v1|" + user + "|req"` (binds the ciphertext to the user and
  the direction).
- Decrypted plaintext = `{ "op": "<name>", "args": { … }, "ts": <unix ms> }`.

Response body:
```json
{ "v": 1, "nonce": "<b64 12 bytes>", "ct": "<b64 ciphertext+tag>" }
```
- AAD = `"athena-mcp-v1|" + user + "|res"`.
- Decrypted plaintext = `{ "status": <int>, "body": <json> }` (the sub-request's
  HTTP status and JSON body, surfaced to the tool).

### Authentication and integrity

- A valid GCM auth tag on decrypt with the user's `K` **proves the caller holds
  the token**. This replaces any bearer/session check for tunnel traffic — no
  token ever transits the wire.
- Replay: the request carries `ts`; the backend rejects a skew greater than
  120 s. A hard replay cache is unnecessary here — a replayed
  `create_transaction` is caught by the dedup UNIQUE constraint (409), and
  `update`/`delete` are effectively idempotent — but the timestamp window
  bounds the exposure. This reasoning is documented, not left implicit.
- Setup/auth failures that reveal nothing sensitive (unknown user, MCP
  disabled, no wrapped key, bad tag, stale timestamp, malformed envelope) are
  returned as **plaintext** JSON errors with status 400/401/403. Only
  operation *content* is ever encrypted.

## Components

### A. Backend — `POST /api/mcp/rpc` (the only externally exposed MCP surface)

New route, **not** behind `requireAuth` (it performs its own crypto auth), with
a dedicated rate limit (e.g. 60 req/min per IP). Steps:

1. Validate the envelope shape (zod). On failure → plaintext 400.
2. Resolve the user by `user` (username). Load `mcp_enabled` + `mcp_key_wrapped`.
   If the user is unknown, MCP is disabled, or no wrapped key exists →
   plaintext 401/403.
3. Unwrap `K` with the master key.
4. AES-256-GCM decrypt `ct` with `K` and the request AAD. Tag failure →
   plaintext 401 (auth failure). Check `ts` skew → 401 if stale.
5. Look up `op` in a fixed **operation registry** (see D) → `(method, path,
   arg-placement)`. Unknown `op` → encrypted error response `{ status: 400 }`.
6. Dispatch internally with `app.inject({ method, url, payload/query,
   headers })`, adding the internal-auth headers (below) so the existing route
   runs as this user through its normal `requireAuth` + handler path.
7. Encrypt `{ status, body }` from the sub-response with `K` and the response
   AAD → return `{ v, nonce, ct }`.

The op registry (not free-form `{method, path}`) is what confines a token
holder to exactly the six intended operations — the tunnel cannot reach any
other internal route.

### B. Backend — internal-dispatch auth in `requireAuth`

File: `backend/src/http/plugins/auth.ts`.

- At server boot, generate `INTERNAL_AUTH_SECRET = crypto.randomBytes(32)`
  held only in process memory — never persisted, logged, or sent to any
  client.
- `requireAuth` gains one branch (session cookie still takes precedence):
  if header `x-athena-internal-auth` equals `INTERNAL_AUTH_SECRET`, trust
  `x-athena-internal-uid` and set request-scoped `req.mcpUserId` (added via
  `app.decorateRequest('mcpUserId', null)`); allow.
- `userId(req)` returns `req.session.userId ?? req.mcpUserId`.
- Only the `/api/mcp/rpc` handler ever attaches these headers, to `app.inject`
  sub-requests (in-process; they never leave the process). An external request
  cannot forge them without guessing 32 random bytes.

No public bearer-token path is added — all MCP access flows through the
encrypted tunnel, keeping the external surface to a single endpoint.

### C. Backend — MCP settings (enable + token)

Storage: **dedicated columns** on `user_settings` (migration `0016`), not the
`settings` JSONB:
- `mcp_enabled boolean NOT NULL DEFAULT false`
- `mcp_key_wrapped text` (nullable)

Columns (not JSONB keys) because `SettingsSchema` is `.strict()`: an unknown
key in the JSONB makes `mergeSettings` reject the whole blob and fall back to
defaults, silently resetting the user's dashboard settings. Columns also mean
`loadSettingsFor` (which selects only `userSettings.settings`) never sees them,
so they are naturally excluded from `GET /api/settings` — no stripping needed.
MCP state is read and mutated only through dedicated endpoints (behind
`requireAuth`, used by the Réglages UI over the normal session cookie):
- `GET /api/settings/mcp` → `{ enabled: boolean, hasToken: boolean }`
  (`hasToken = mcp_key_wrapped IS NOT NULL`; never returns key material)
- `PUT /api/settings/mcp` → `{ enabled }` toggle
- `POST /api/settings/mcp/token` → generate token → derive `K` → wrap `K` →
  store `mcp_key_wrapped` → return `{ token }` **once**. Regeneration overwrites
  the wrapped key (old token stops working immediately).
- `DELETE /api/settings/mcp/token` → set `mcp_key_wrapped` to null (revoke).

Writes upsert the `user_settings` row (created lazily — a user who never
touched settings has no row yet), setting the mcp columns and leaving the
`settings` JSONB at its default.

### D. MCP server package `/mcp`

Standalone TypeScript package (peer of `backend/` and `frontend/`), using
`@modelcontextprotocol/sdk` with `StdioServerTransport`.

Config (env, read at startup; fail fast with a clear message if missing):
- `ATHENA_API_URL` — backend base URL, e.g. `http://<mini-pc-host>:<port>`
- `ATHENA_MCP_USER` — the Athena username (goes in the envelope, non-secret)
- `ATHENA_MCP_TOKEN` — the token generated in Réglages

Layout:
```
mcp/
  package.json
  tsconfig.json
  src/
    index.ts        # server bootstrap: register tools, connect stdio transport
    crypto.ts       # HKDF key derivation + AES-256-GCM encrypt/decrypt envelope
    client.ts       # rpc(op, args): encrypt → POST /api/mcp/rpc → decrypt → map status
    ops.ts          # op registry shared shape (names + arg schemas)
    tools/
      accounts.ts       # list_accounts
      categories.ts     # list_categories
      transactions.ts   # search / create / update / delete
```

Operation registry (identical op names on both sides; backend maps to routes):

| op (tool) | method / path | args |
|---|---|---|
| `list_accounts` | `GET /api/accounts` | — |
| `list_categories` | `GET /api/categories` | — |
| `search_transactions` | `GET /api/transactions` (args → query) | `search?`, `accountId?`, `categoryId?`, `fromDate?`, `toDate?`, `amount?`, `limit?`, `offset?` |
| `create_transaction` | `POST /api/transactions` (args → body) | `accountId`, `date`, `amount`, `rawLabel`, `notes?`, `categoryId?`, `lockYears?` |
| `update_transaction` | `PATCH /api/transactions/{id}` (rest → body) | `id` + any of `accountId/date/amount/rawLabel/categoryId/notes/lockYears` |
| `delete_transaction` | `DELETE /api/transactions/{id}` | `id` |

`client.ts` maps the decrypted `status` → tool-level error text:
- 401/403 → "MCP access is disabled or the token is invalid (check Réglages → MCP)"
- 400 → "invalid input" + the API's `issues`
- 404 → "transaction not found"
- 409 → the API's French conflict message (duplicate, or split-amount lock)
- other non-2xx → generic "backend error <status>"

`search_transactions` returns a trimmed shape (id, date, amount, rawLabel,
categoryId, accountId) so the model can find the id to edit/delete without
drowning in fields.

Build: `tsc` → `mcp/dist`; the documented client-launch command runs
`node mcp/dist/index.js` (or `npx tsx mcp/src/index.ts` in dev).

### E. Frontend — Réglages "Accès MCP" section

A card on the settings page:
- Enable toggle bound to `PUT /api/settings/mcp`.
- Token control:
  - No token yet → "Générer un jeton" button.
  - On generate → show the plaintext token **once** in a copyable field with a
    clear "ce jeton ne sera plus affiché" warning, plus a reminder to also set
    `ATHENA_MCP_USER` in the client config.
  - Token exists (`hasToken`) → "Jeton actif" with "Régénérer" and "Révoquer".
- Wired via TanStack Query against `/api/settings/mcp`.

## Error handling summary

- Missing/invalid MCP env in the server → exit at startup with a readable message.
- Backend down / unreachable → tool returns a connection error, not a crash.
- Setup/auth failures → plaintext JSON errors (reveal nothing sensitive).
- Operation results/errors → always encrypted; status mapped to readable tool
  errors (see D).

## Testing

- **Backend (Vitest):**
  - Crypto round-trip: wrap/unwrap `K`; envelope encrypt/decrypt with correct
    and wrong keys/AAD (tamper → tag failure).
  - `/api/mcp/rpc`: happy path per op; MCP disabled; unknown user; bad tag;
    stale `ts`; unknown `op`; malformed envelope.
  - `requireAuth` internal branch: correct secret allows as the given uid;
    wrong/absent secret denies; the header cannot authenticate a direct
    external call to a normal route.
  - `/api/settings/mcp`: GET shape, PUT toggle, POST returns token once and
    stores a wrapped key, DELETE revokes, regeneration invalidates the old
    token.
  - General `GET /api/settings` response contains no mcp fields (the mcp
  columns are not selected by `loadSettingsFor`).
- **MCP (Vitest):**
  - `crypto.ts` matches the backend scheme (shared test vectors: same token →
    same `K`; a fixed nonce+key produces the expected ciphertext).
  - `client.ts` status→error mapping.
  - Each tool's op+args shaping against a mocked transport.
  - Documented manual smoke test against a live backend.

## Documentation

- `docs/mcp.md`: enable MCP in Réglages, generate a token, set `ATHENA_API_URL`
  + `ATHENA_MCP_USER` + `ATHENA_MCP_TOKEN`, an example MCP-client config
  (mcphost / Claude Desktop JSON) using Ollama, a note that content is
  encrypted app-side (TLS optional), and the LAN-URL note. Placeholders only.
- README: short "MCP access" subsection linking to `docs/mcp.md`.

## Security notes

- The token is a bearer-grade secret with full CRUD over financial data — treat
  it like a password. Never at rest in plaintext (only `K` wrapped under a
  `SESSION_SECRET`-derived master key); shown to the user once.
- All operation content is encrypted with AES-256-GCM; the auth tag both
  authenticates the caller and guarantees integrity. Nothing sensitive — not
  even search terms or amounts — appears on the wire.
- `INTERNAL_AUTH_SECRET` is process-random, memory-only, and never logged or
  emitted; it exists solely to let `app.inject` sub-requests authenticate.
- The tunnel confines callers to a fixed op registry — no arbitrary internal
  routes.
- Revoke = clear the wrapped key; rotate = regenerate (old token dies at once).
- Rotating `SESSION_SECRET` invalidates every stored wrapped key (tokens must
  be regenerated) — documented as a known, acceptable coupling.

## Out of scope (YAGNI, for now)

- Transaction splits (ventilation) and bulk-delete tools.
- Multiple/named/labelled tokens and last-used tracking.
- A hard replay-nonce cache (timestamp window + dedup suffice at this scale).
- HTTP/SSE MCP transport or a hosted daemon; stdio only.
