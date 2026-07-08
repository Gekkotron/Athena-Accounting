# Athena MCP Server — Design

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation plan

## Goal

Expose Athena's transaction operations (add / update / remove, plus the reads
needed to use them) over the Model Context Protocol, so a local LLM — e.g. an
Ollama model driven through an MCP client on the user's Mac — can manage
transactions. Everything stays local: the MCP client runs on the Mac, the
Athena backend runs on the LAN mini-PC, and no data leaves the network.

## Constraints & context

- **Reuse, don't reimplement.** The Fastify backend already has a complete,
  authenticated transaction API. The MCP server calls that API over HTTP; it
  never touches PostgreSQL directly. This inherits, for free, the invariants
  the API enforces: dedup (`UNIQUE(account_id, dedup_key)`), the
  auto-categorization rule engine, transfer-leg unlinking on delete, and the
  split-amount DB trigger.
- **Ollama is a model backend, not an MCP client.** Ollama itself does not
  speak MCP. What we build is a standard, model-agnostic MCP server; wiring it
  to Ollama is done inside an MCP client (mcphost, Claude Desktop, oterm, …)
  and is documented, not coded.
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
        │  env: ATHENA_API_URL, ATHENA_MCP_TOKEN
        │  HTTP + "Authorization: Bearer <token>"  (over LAN)
        ▼
Fastify backend (mini-PC)
        │  requireAuth resolves token → user
        ▼
existing /api/transactions, /api/accounts, /api/categories handlers
        ▼
PostgreSQL
```

## Components

### A. Backend — bearer-token auth path

File: `backend/src/http/plugins/auth.ts`.

Extend `requireAuth` so a request authenticates by **either** a session cookie
(existing behaviour, takes precedence) **or** a bearer token:

1. If `req.session.userId` is set → authenticated (unchanged).
2. Else if `Authorization: Bearer <token>` is present:
   - Compute `sha256(token)` (hex).
   - Look up the `user_settings` row whose `settings.mcpTokenHash` equals that
     hash **and** `settings.mcpEnabled === true`.
   - If found → set a request-scoped `req.mcpUserId` (added via
     `app.decorateRequest('mcpUserId', null)`), and allow the request.
3. Else → `401 { error: 'authentication required' }`.

`userId(req)` returns `req.session.userId ?? req.mcpUserId`, throwing only when
neither is set. This is the single accessor every route already uses, so the
token identity flows everywhere with no per-route change.

Design notes:
- The token path deliberately does **not** set `req.session.userId`, so no
  cookie/session is created for machine requests (avoids per-request writes to
  the in-memory session store).
- sha256 (not argon2) is correct: the token is a high-entropy random secret,
  not a low-entropy password. Exact-hash DB lookup means username enumeration
  / timing concerns do not apply.
- The bearer path is inert unless MCP is both enabled and has a token — a
  disabled account or a cleared token yields no matching row → 401.

### B. Backend — MCP settings (enable + token)

Storage: the existing per-user `user_settings.settings` JSONB gains two keys:
- `mcpEnabled: boolean` (default `false`)
- `mcpTokenHash: string | null` (sha256 hex of the current token; default null)

These are **not** exposed through the generic `PATCH /api/settings` surface.
`mcpTokenHash` is never returned by any endpoint. `loadSettingsFor` (in
`backend/src/http/routes/settings.ts`) strips `mcpTokenHash` (and `mcpEnabled`)
from the general `GET /api/settings` response; MCP state is read only through
the dedicated endpoints below.

Dedicated endpoints (new, behind `requireAuth`, session-cookie use expected
from the Réglages UI):
- `GET /api/settings/mcp` → `{ enabled: boolean, hasToken: boolean }`
- `PUT /api/settings/mcp` → body `{ enabled: boolean }` → toggles `mcpEnabled`
- `POST /api/settings/mcp/token` → generates a random token (≥ 32 bytes,
  base64url), stores its sha256 as `mcpTokenHash`, returns `{ token }`
  **once**. Regeneration overwrites the previous hash (old token stops
  working).
- `DELETE /api/settings/mcp/token` → sets `mcpTokenHash` to null (revoke).

Writes use the same JSONB upsert/merge pattern already in `settingsRoutes`.

### C. Backend — no other changes

Transaction, account, and category routes are reused verbatim. The token user
is a real user id, so `eq(userId, uid)` scoping is unchanged.

### D. MCP server package `/mcp`

A standalone TypeScript package (peer of `backend/` and `frontend/`), using
`@modelcontextprotocol/sdk` with `StdioServerTransport`.

Config (env, read at startup; fail fast with a clear message if missing):
- `ATHENA_API_URL` — base URL of the backend, e.g. `http://<mini-pc-host>:<port>`
- `ATHENA_MCP_TOKEN` — the bearer token generated in Réglages

Layout:
```
mcp/
  package.json
  tsconfig.json
  src/
    index.ts        # server bootstrap: register tools, connect stdio transport
    client.ts       # fetch wrapper: base URL + Bearer header + error mapping
    tools/
      accounts.ts       # list_accounts
      categories.ts     # list_categories
      transactions.ts   # search / create / update / delete
```

`client.ts` maps HTTP status → tool-level error text:
- 401 → "MCP access is disabled or the token is invalid (check Réglages → MCP)"
- 400 → "invalid input" + the API's `issues`
- 404 → "transaction not found"
- 409 → the API's French conflict message (duplicate, or split-amount lock)
- other non-2xx → generic "backend error <status>"

Tools (input validated with zod; each returns structured JSON content):

| Tool | Method / endpoint | Key args |
|---|---|---|
| `list_accounts` | `GET /api/accounts` | — |
| `list_categories` | `GET /api/categories` | — |
| `search_transactions` | `GET /api/transactions` | `search?`, `accountId?`, `categoryId?`, `fromDate?`, `toDate?`, `amount?`, `limit?`, `offset?` |
| `create_transaction` | `POST /api/transactions` | `accountId`, `date`, `amount`, `rawLabel`, `notes?`, `categoryId?`, `lockYears?` |
| `update_transaction` | `PATCH /api/transactions/:id` | `id` + any of `accountId/date/amount/rawLabel/categoryId/notes/lockYears` |
| `delete_transaction` | `DELETE /api/transactions/:id` | `id` |

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
    clear "ce jeton ne sera plus affiché" warning.
  - Token exists (`hasToken`) → show "Jeton actif" with "Régénérer" and
    "Révoquer" actions.
- Wired via TanStack Query mutations/queries against `/api/settings/mcp`.

## Error handling summary

- Missing/invalid MCP env in the server → exit at startup with a readable message.
- Backend down / unreachable → tool returns a connection error, not a crash.
- All API error statuses are surfaced as readable tool errors (see D).
- Auth: disabled MCP or wrong token → 401 → mapped tool error.

## Testing

- **Backend (Vitest):**
  - Bearer auth path: valid token, invalid token, MCP disabled, no token,
    malformed header — each asserts allow/deny and correct resolved user.
  - `/api/settings/mcp`: GET shape, PUT toggle, POST returns token once and
    stores a hash, DELETE revokes, regeneration invalidates the old token.
  - General `GET /api/settings` never leaks `mcpTokenHash`.
- **MCP (Vitest):**
  - `client.ts` status→error mapping.
  - Each tool's argument→request mapping against a mocked fetch (method, path,
    query/body, header).
  - Documented manual smoke test against a live backend.

## Documentation

- `docs/mcp.md`: enable MCP in Réglages, generate a token, set `ATHENA_API_URL`
  + `ATHENA_MCP_TOKEN`, and an example MCP-client config (mcphost / Claude
  Desktop JSON) using Ollama as the model. LAN-URL note. Placeholders only.
- README: short "MCP access" subsection linking to `docs/mcp.md`.

## Security notes

- The token is a bearer secret with full CRUD over financial data — treat it
  like a password. Hashed at rest (sha256), shown in plaintext once.
- The bearer path is active only when MCP is enabled **and** a token exists.
- Revoke = clear the hash; rotate = regenerate (old token dies immediately).

## Out of scope (YAGNI, for now)

- Transaction splits (ventilation) and bulk-delete tools.
- Multiple/named/labelled tokens and last-used tracking.
- HTTP/SSE transport or a hosted daemon; stdio only.
