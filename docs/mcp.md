# MCP access

Athena ships an optional [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) server so a local LLM — for example a model running in
[Ollama](https://ollama.com), driven through an MCP-capable client — can
create, update, delete, and search your transactions.

## What it is

- A local **stdio** MCP server (`mcp/`) that exposes 6 tools for working
  with transactions (see [Tools reference](#tools-reference) below). It
  runs as a child process of your MCP client — nothing is exposed on the
  network by the server itself.
- Every request/response between the MCP server and the Athena backend
  (`POST /api/mcp/rpc`) is encrypted end-to-end with a per-user token,
  using AES-256-GCM. The backend derives a content key from your token
  and stores only a wrapped (encrypted) copy of that key — never the
  token itself. Nothing related to your transactions travels the LAN in
  plaintext, and TLS on top is optional (useful if you also want to hide
  metadata like request timing/size, but not required for confidentiality
  of the content).
- Ollama itself is **not** an MCP client — it's the model backend that an
  MCP-aware client (e.g. `mcphost`, `oterm`, Claude Desktop) points at. The
  Athena MCP server is model-agnostic: it just answers tool calls over
  stdio, however the client chooses to use them.

## 1. Enable MCP access

1. Open **Réglages** (the gear icon next to your username in the sidebar).
2. In the **Accès MCP** section, toggle **Activer l'accès MCP**.
3. Click **Générer un jeton**. The token is shown **once** — copy it now.
   You won't be able to see it again; if you lose it, generate a new one
   (this immediately invalidates the previous token).

## 2. Build the server

```sh
cd mcp
npm install
npm run build
```

This produces `mcp/dist/index.js`, the entry point your MCP client will
launch.

## 3. Configure your MCP client

Point your MCP client at the built server, passing the three required
environment variables. Example configuration (the JSON shape used by
Claude Desktop and several other MCP clients):

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

Replace the placeholders:

- `ATHENA_API_URL` — the URL of your Athena backend (e.g. the LAN address
  and port where `backend` is reachable). Do not include a trailing slash.
- `ATHENA_MCP_USER` — your Athena login username.
- `ATHENA_MCP_TOKEN` — the token generated in step 1.

All three are required; the server refuses to start if any is missing.

## 4. Use with Ollama

If you want the MCP client to use a local Ollama model, that's configured
in the **client**, not in Athena's MCP server. For example, `mcphost` and
`oterm` both let you pick an Ollama model as their backend while using
this server (and others) as tool providers. Consult your chosen client's
documentation for how to point it at Ollama — the Athena server has no
knowledge of, or dependency on, which model is driving the conversation.

## Tools reference

| Tool | Purpose | Key arguments |
|------|---------|----------------|
| `list_accounts` | List accounts with balances and ids. | — |
| `list_categories` | List categories with ids and kinds. | — |
| `search_transactions` | Search/list transactions. Use this to find a transaction id before updating or deleting. | `search`, `accountId`, `categoryId`, `fromDate`, `toDate` (`YYYY-MM-DD`), `amount` (decimal string), `limit` (1–500), `offset` |
| `create_transaction` | Create a transaction. Negative amount = expense, positive = income. | `accountId` (required), `date` (required, `YYYY-MM-DD`), `amount` (required, decimal string), `rawLabel` (required, 1–512 chars), `notes` (optional, ≤2000 chars), `categoryId` (optional), `lockYears` (optional, 0–99) |
| `update_transaction` | Update fields of an existing transaction by id. | `id` (required), plus any of `accountId`, `date`, `amount`, `rawLabel`, `categoryId` (nullable), `notes` (nullable), `lockYears` (nullable) |
| `delete_transaction` | Delete a transaction by id. | `id` (required) |

Amounts are decimal strings with up to 2 decimal places (e.g. `"-42.50"`).
Dates are `YYYY-MM-DD`.

## Security

- The MCP token is a **full-CRUD credential** for your transaction data —
  treat it like a password. Anyone who has it can read, create, edit, and
  delete transactions on your account via the MCP server.
- The token is shown **once**, at generation time, and is never stored in
  plaintext server-side (the backend only keeps a key wrapped under a
  key derived from `SESSION_SECRET`).
- You can revoke or regenerate the token at any time from **Réglages →
  Accès MCP** (clicking **Régénérer le jeton** / **Révoquer** immediately
  invalidates the previous token — any running MCP client using it will
  start failing authentication and needs the new token).
- Rotating the backend's `SESSION_SECRET` invalidates every wrapped MCP
  key (the backend can no longer unwrap it), which effectively revokes
  all MCP tokens. After rotating `SESSION_SECRET`, generate a fresh token
  in Réglages and update your MCP client configuration.

## Manual smoke test

With the Athena backend running:

1. Enable MCP access and generate a token in Réglages (see step 1 above).
2. Build the server (`cd mcp && npm install && npm run build`).
3. Configure your MCP client with the three env vars from step 3 above,
   pointing `command`/`args` at `mcp/dist/index.js`.
4. Launch the client so it starts the server (or run
   `node mcp/dist/index.js` directly under the client's stdio transport).
5. From the client, call `list_accounts` — it should return your accounts
   and balances. Then call `create_transaction` with a valid `accountId`,
   `date`, `amount`, and `rawLabel` — it should return the created
   transaction, which you can confirm in the Athena UI.
