---
title: Code map
sidebar_position: 3
---

# Code map

A guided tour of the repository so you know where to look for what.
Complements the architecture page: architecture explains *why*, this
page explains *where*.

## Top-level layout

The repo is a monorepo of independent workspaces glued together by
Docker Compose (for the server stack) and Tauri (for the desktop
app). Each workspace owns its own `package.json`, `tsconfig.json`,
and test config; there is no root `package.json`.

| Directory      | What it is                                                         |
| -------------- | ------------------------------------------------------------------ |
| `backend/`     | Fastify + Drizzle API server (Node/TypeScript).                    |
| `frontend/`    | React + Vite single-page app served by nginx in production.        |
| `mcp/`         | Optional Model Context Protocol server for local LLM access.      |
| `desktop/`     | Tauri wrapper that bundles the whole stack as a native app.        |
| `website/`     | Docusaurus site (EN + FR) that publishes `docs/` at build time.    |
| `docs/`        | Source of truth for user, contributor, dev, and reference docs.    |
| `.github/`     | CI workflows, issue templates, funding and PR templates.           |

Root-level files worth knowing: `docker-compose.yml` and
`docker-compose.test.yml` (server stack), `install.sh` /
`update.sh` (one-shot host setup), `README.md`, `CONTRIBUTING.md`,
and `PLAN.md` (the machine-readable backlog driven by the Athena
Orchestrator — see `CLAUDE.md` for its contract).

## `backend/src` tour

The backend is split into four layers plus a thin `lib/` for pure
helpers. Layer order in imports goes `entry → http → domain → db`;
nothing lower reaches back up.

- **`db/`** — the Drizzle layer. All persistence lives here:
  `schema.ts` defines every table and enum, `client.ts` opens the
  Postgres pool, `migrate.ts` runs `drizzle-kit` migrations at
  startup, and `server.ts` / `tauri.ts` are alternate connection
  bootstraps (server-managed Postgres vs. Tauri-embedded). Generated
  SQL migrations land in `db/migrations/` (e.g. `0000_init.sql`) —
  never hand-edit those. Open first:
  `backend/src/db/schema.ts`.

- **`domain/`** — business logic, framework-free. One folder per
  bounded context: `auth/` (local user, hashing), `backup/` (portable
  dump builder plus the remote-backup stack: WebDAV/folder providers,
  encrypted destination store, seal-upload-prune runner, nightly
  scheduler), `imports/` (CSV, OFX, PDF, and photo/OCR pipelines under
  `imports/ocr/`, `pdf/`, `photo/`), `reconcile/` (matching bank rows
  against expected entries), `rules/` (auto-categorization),
  `settings/` (encrypted key-value store with `crypto.ts`), and
  `transfers/` (inter-account transfer detection). No Fastify or HTTP
  imports allowed here. Open first:
  `backend/src/domain/imports/import-service.ts`.

- **`http/`** — the Fastify surface. `routes/` has one file per
  resource (`accounts.ts`, `budgets.ts`, `reports.ts`,
  `envelopes.ts`, etc.) and `plugins/` holds cross-cutting concerns
  (auth guard, metrics). Route files parse input, call domain code,
  and shape responses — nothing more. Open first:
  `backend/src/http/routes/accounts.ts`.

- **`entry/`** — process entrypoints. `backup/` runs scheduled
  backups, `mcp/` hosts the embedded MCP server, `tips/` seeds the
  onboarding tips table, and `transactions/` runs one-off batch jobs
  (backfills, re-categorization). Each is a standalone `node`
  target. Open first: `backend/src/entry/backup/`.

- **`lib/envelope-math.ts`** — the pure math behind budget envelopes
  (allocation, rollover, remaining). Keep it framework- and IO-free;
  it is imported by both domain code and tests.

- Top-level files: `buildServer.ts` wires Fastify + plugins +
  routes; `env.ts` validates environment variables at boot;
  `dataDir.ts` resolves the per-platform data directory (LAN server
  vs. desktop).

## `frontend/src` tour

The frontend is a Vite-built React SPA. State lives in TanStack
Query (server state) and React context (UI state). No Redux, no
global store.

- **`api/`** — typed HTTP clients, one file per resource
  (`accounts.ts`, `imports.ts`, `pdf-templates.ts`, …). `client.ts`
  is the shared `fetch` wrapper with auth and error normalization;
  `types.ts` mirrors the backend's DTOs by hand (there is no code
  generation between the two — keep them in sync manually).
  `api/demo/` fakes the whole surface for the public demo build.
  Open first: `frontend/src/api/client.ts`.

- **`pages/`** — one folder per top-level route (`Accounts/`,
  `Budgets/`, `Dashboard/`, `Data/`, `Imports/`, `Rules/`,
  `Transactions/`) plus login/profile/settings at the root. Each
  page folder holds its screens, sub-components, and its own
  `__tests__/`. Open first: `frontend/src/pages/Dashboard/`.

- **`components/`** — reusable widgets shared across pages: charts
  (`CategoryDonut.tsx`, `Sankey.tsx`, `Sparkline.tsx`,
  `BalanceChart/`), layout (`Layout.tsx`, `HubLayout.tsx`,
  `NavIcons.tsx`), tips (`SectionTip.tsx`, `WelcomeTour.tsx`), and
  the PDF template editor (`PdfTemplateBuilder/`). Open first:
  `frontend/src/components/Layout.tsx`.

- **`contexts/`** — React contexts for cross-page UI state:
  `PrivacyContext.tsx` (blur amounts) and `TipsContext.tsx`
  (dismissed-tip tracking).

- **`lib/`** — small pure helpers: `format.ts` (French currency and
  dates), `normalize.ts`, `label-similarity.ts`,
  `persisted-state.ts`, plus a few React hooks (`useBudgets.ts`,
  `useEnvelopes.ts`, `useSettings.ts`). No components here.

- **`i18n/`** and **`locales/`** — translation setup and JSON string
  bundles (French is the default; English is present).

- **`tips/`** — in-app contextual tips content and the machinery
  that decides when to show them.

- **`test/`** — Vitest + React Testing Library setup shared by every
  `__tests__/` folder.

- `App.tsx` wires the router; `main.tsx` mounts React into
  `index.html`.

## `mcp/src` tour

The MCP server is intentionally tiny — five files, no
subdirectories:

- **`index.ts`** — process entrypoint; wires the stdio transport.
- **`tools.ts`** — the actual Model Context Protocol tool
  definitions (list accounts, query transactions, etc.). This is the
  file to open first: `mcp/src/tools.ts`.
- **`client.ts`** — HTTP client that calls back into the Athena
  backend, so the MCP server is a thin adapter, not a second source
  of truth.
- **`config.ts`** — env + config-file loading.
- **`crypto.ts`** — token handling for the backend session.

Tests live in `mcp/tests/`, not `__tests__/`, because there is no
per-folder structure to colocate them next to.

## Other directories worth knowing

- **`desktop/src-tauri/`** — the Rust side of the Tauri app
  (`Cargo.toml`, `src/`, `tauri.conf.json`, `capabilities/`,
  `icons/`). **`desktop/sidecar/`** ships a bundled Node runtime and
  a pre-built `entry.js` so the desktop app can spawn the backend
  as a sidecar process without a system Node install.

- **`website/`** — Docusaurus. `docusaurus.config.ts` is the
  entrypoint; `sidebars.ts` controls the doc tree; `i18n/fr/`
  mirrors every English page under
  `docusaurus-plugin-content-docs/current/`. When you edit anything
  in `docs/`, mirror it in the FR tree in the same commit.

- **`docs/`** — Markdown sources consumed by the website. Split into
  `users/`, `contributors/` (you are here), `dev/`, `reference/`,
  `superpowers/`, and `RELEASES/`.

- **`.github/`** — `workflows/` holds every CI pipeline (lint, test,
  build, release); `ISSUE_TEMPLATE/` and
  `PULL_REQUEST_TEMPLATE.md` define the contribution surface;
  `FUNDING.yml` points at GitHub Sponsors.

## Shared conventions

- **No `tsconfig` path aliases.** Both `backend/tsconfig.json` and
  `frontend/tsconfig.json` use plain relative imports
  (`../../db/schema`). We chose readability of grep results over
  short imports; do not add `paths` mappings.

- **Tests colocate in `__tests__/`.** For every source folder that
  has tests, there is a sibling `__tests__/` directory containing
  `<name>.test.ts` (or `.test.tsx` for React). Vitest is the runner
  in both workspaces; Playwright drives `frontend/e2e/` end-to-end
  suites.

- **Generated code lands in predictable places, never as hand-edited
  files in `src/`.** Drizzle SQL migrations live in
  `backend/src/db/migrations/` and are produced by
  `drizzle-kit generate` from `schema.ts` — commit both the schema
  change and the generated `.sql` file together. Frontend/backend
  DTO types are *not* generated: `frontend/src/api/types.ts`
  mirrors backend responses by hand, and there is no OpenAPI client.
  Tauri generates `desktop/src-tauri/gen/` at build time; do not
  commit changes there.

- **French decimals.** Any UI that reads a monetary amount uses
  `<input type="text" inputMode="decimal">` and `parseDecimal` from
  `lib/format.ts`, never `<input type="number">`. See
  `frontend/src/lib/format.ts` for the helper.

- **Bounded contexts stay bounded.** Backend `domain/` folders do
  not import each other; if two contexts genuinely share logic,
  promote the helper to `backend/src/lib/`.

*See also:* [Architecture](architecture.md) ·
[Development](development.md)

← [Back to contributor docs](README.md)
