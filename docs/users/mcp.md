---
title: MCP access
sidebar_position: 8
---

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

1. Open **Settings** (the gear icon next to your username in the sidebar).
2. In the **Accès MCP** section, toggle **Activer l'accès MCP**.
3. Click **Generate a token**. The token is shown **once** — copy it now.
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
        "ATHENA_API_URL": "http://<mini-pc-host>:8001",
        "ATHENA_MCP_USER": "<your-athena-username>",
        "ATHENA_MCP_TOKEN": "<paste-token-here>",
        "ATHENA_STATEMENTS_DIR": "/Users/you/AthenaStatements"
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
- `ATHENA_STATEMENTS_DIR` *(optional)* — a folder your statement PDFs live in.
  When set, `reconcile_statement` resolves a **bare filename** (e.g.
  `april.pdf`) against it, so you don't have to type a full absolute path. A
  leading `~` is expanded, and if a file isn't found the error lists the `.pdf`
  files actually in the folder.

All three are required; the server refuses to start if any is missing.

### Desktop (Tauri) app: use a port file instead of `ATHENA_API_URL`

The desktop distribution binds Fastify to `127.0.0.1` on an OS-assigned port,
so the URL changes every launch. Instead of hard-coding a URL, point the MCP
bridge at the port file the app writes on startup:

```json
{
  "mcpServers": {
    "athena": {
      "command": "node",
      "args": ["/absolute/path/to/Athena-Accounting/mcp/dist/index.js"],
      "env": {
        "ATHENA_PORT_FILE": "<DATA_DIR>/.mcp-port",
        "ATHENA_MCP_USER": "<your-athena-username>",
        "ATHENA_MCP_TOKEN": "<paste-token-here>"
      }
    }
  }
}
```

`<DATA_DIR>` is where the desktop app stores its data — the same folder that
holds `athena.db`. Defaults per OS:

- macOS: `~/Library/Application Support/com.athena.accounting.desktop/`
- Linux: `~/.local/share/com.athena.accounting.desktop/`
- Windows: `%APPDATA%\com.athena.accounting.desktop\`

The bridge reads the port from that file each time it starts, so opening and
closing the desktop app between MCP client sessions works transparently. If
both `ATHENA_API_URL` and `ATHENA_PORT_FILE` are set, `ATHENA_API_URL` wins.

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
| `reconcile_statement` | Reconcile a bank-statement PDF against Athena's transactions (read-only). See [Reconcile a statement](#reconcile-a-statement) below. | `path` (required, absolute PDF path), `accountId` (required), `fromDate`, `toDate` (`YYYY-MM-DD`) |

Amounts are decimal strings with up to 2 decimal places (e.g. `"-42.50"`).
Dates are `YYYY-MM-DD`.

## Security

- The MCP token is a **full-CRUD credential** for your transaction data —
  treat it like a password. Anyone who has it can read, create, edit, and
  delete transactions on your account via the MCP server.
- The token is shown **once**, at generation time, and is never stored in
  plaintext server-side (the backend only keeps a key wrapped under a
  key derived from `SESSION_SECRET`).
- You can revoke or regenerate the token at any time from **Settings →
  Accès MCP** (clicking **Régénérer le jeton** / **Révoquer** immediately
  invalidates the previous token — any running MCP client using it will
  start failing authentication and needs the new token).
- Rotating the backend's `SESSION_SECRET` invalidates every wrapped MCP
  key (the backend can no longer unwrap it), which effectively revokes
  all MCP tokens. After rotating `SESSION_SECRET`, generate a fresh token
  in Settings and update your MCP client configuration.

## Manual smoke test

With the Athena backend running:

1. Enable MCP access and generate a token in Settings (see step 1 above).
2. Build the server (`cd mcp && npm install && npm run build`).
3. Configure your MCP client with the three env vars from step 3 above,
   pointing `command`/`args` at `mcp/dist/index.js`.
4. Launch the client so it starts the server (or run
   `node mcp/dist/index.js` directly under the client's stdio transport).
5. From the client, call `list_accounts` — it should return your accounts
   and balances. Then call `create_transaction` with a valid `accountId`,
   `date`, `amount`, and `rawLabel` — it should return the created
   transaction, which you can confirm in the Athena UI.

## Reconcile a statement

`reconcile_statement` checks a bank-statement PDF against what's already
recorded in Athena, without changing anything.

### What it does

- Reads the PDF you point it at and parses it using the **same import
  template** Athena's PDF import already has saved for that account (the
  zones that tell Athena where the date/amount/label columns are on the
  page).
- Compares the parsed statement lines against your Athena transactions for
  the account and date range, and buckets the result into:
  - **matched** — statement line found in Athena with the same date,
    amount, and label.
  - **missing** — on the statement, not in Athena.
  - **mismatched** — an existing transaction has the same normalized label
    and a date within ±3 days of the statement line; if the amount also
    differs, it's reported as `amount_differs`, otherwise (same amount,
    just off by a few days) it's `date_off`.
  - **extra** — in Athena for that account/period, not on the statement
    (transfers between your own accounts are excluded from this bucket).
- The backend renders a human-readable summary (`summaryText`) alongside
  the structured buckets. The tool — and the LLM calling it — only ever
  **reads**; it never creates, edits, or deletes a transaction.

### Prerequisite: a saved import template

The account you're reconciling against must already have a working PDF
import template. If you've never imported a statement from this bank/
account combination through Athena's normal PDF import screen, there's no
template yet, and `reconcile_statement` will fail with a `needs_template`
error instead of guessing at the layout. Import the statement (or any
statement from the same bank template) once via Athena's UI first, then
retry the tool.

`needs_template` can happen for a few reasons:

- `no_text_layer` — the PDF has no extractable text (e.g. a scanned
  image); Athena's import needs a text layer to train a template on.
- `no_template` — no template has been saved yet for this exact
  bank-statement layout + account.
- `template_stale` — a template exists but the PDF's layout no longer
  matches it (e.g. the bank changed its statement format); re-train the
  template via a fresh import in Athena.

A password-protected PDF returns a separate `pdf_encrypted` error —
remove the password before retrying.

### Usage in LM Studio

1. Load a tools-capable model in LM Studio (or another MCP-aware client)
   with the Athena MCP server configured as described above.
2. In chat, ask something like:

   > Use reconcile_statement with path /Users/you/statements/april.pdf and
   > accountId 66.

3. The model calls `reconcile_statement`, and you read back its summary —
   for example, "12 statement lines: 10 matched, 1 missing, 1 mismatch, 0
   extra," followed by the details of the missing/mismatched lines.

Not sure of the account id? Call `list_accounts` first — it returns each
account's id along with its name and balance.

### Adding the missing transactions

`reconcile_statement` never writes to Athena, so it can't add the rows it
reports as missing on your behalf. To add them, import the **same PDF**
through Athena's normal statement-import flow: the importer's
deduplication logic will insert only the transactions that aren't already
recorded and skip everything that's already there.

### Tool reference

`reconcile_statement(path, accountId, fromDate?, toDate?)`

- `path` (required) — the statement PDF **on the machine running the MCP
  server** (not the machine running the chat client). Either a **bare
  filename** resolved against `ATHENA_STATEMENTS_DIR` (see step 3) or an
  absolute path; a leading `~` is expanded. Must end in `.pdf` and be at
  most 10 MB.
- `accountId` (required) — the Athena account id to reconcile against — the
  small integer from `list_accounts`, **not** the bank account number.
- `fromDate`, `toDate` (optional, `YYYY-MM-DD`) — restrict the comparison
  window. If omitted, the window defaults to the earliest/latest dates
  found on the parsed statement.

### Known limitation: OFX/QFX-imported transactions

Matching is based on a dedup key derived from account + date + amount +
normalized label. Transactions that were originally imported from an
**OFX/QFX** file are keyed differently: the bank's own transaction id
(FITID), when present, is used instead of that derived key, because it's
more durable across label edits. That means an OFX-imported transaction
won't share the same dedup key as the equivalent line parsed from a PDF
statement, so reconciling a PDF statement against OFX-imported
transactions may report an exact match as a **mismatch** instead (usually
with a date-based reason) even though it's really the same transaction.

Reconciling a PDF statement against transactions that were themselves
imported from a PDF, or created manually/via `create_transaction`, matches
exactly, since both sides use the same derived dedup key.
