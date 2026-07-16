---
title: Architecture
sidebar_position: 2
---

# Architecture

## System in one sentence

Athena is a three-container stack — a React frontend, a Fastify
backend, and a PostgreSQL database — orchestrated by Docker Compose
and designed to run on a single host. An optional fourth container
runs a Model Context Protocol server for local LLM access.

## Diagram

```
                    ┌─────────────────────────────────────┐
                    │  Browser  (127.0.0.1:8000)          │
                    │  React 18 + Vite + TanStack Query   │
                    └────────────────┬────────────────────┘
                                     │  HTTP
                                     ▼
                    ┌─────────────────────────────────────┐
                    │  Frontend container                 │
                    │  nginx serving built Vite assets    │
                    │  (proxies /api → backend:3000)      │
                    └────────────────┬────────────────────┘
                                     │  HTTP
                                     ▼
                    ┌─────────────────────────────────────┐
                    │  Backend container                  │
                    │  Node 20 + Fastify 5 + TypeScript   │
                    │  Drizzle ORM · argon2id · pg driver │
                    │  Host port 8001 → container 3000    │
                    └────────────────┬────────────────────┘
                                     │  SQL
                                     ▼
                    ┌─────────────────────────────────────┐
                    │  PostgreSQL 16 container            │
                    │  pg_trgm · unaccent · pgcrypto      │
                    │  Host port 5432 bound to 127.0.0.1  │
                    └─────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
                    │  (Optional) MCP container           │
                    │  End-to-end encrypted with a        │
                    │  per-user token; talks to backend.  │
                    └─────────────────────────────────────┘
```

## Service split

| Container | Runtime | Host port | Container port | Responsibility |
|-----------|---------|-----------|----------------|----------------|
| `frontend` | nginx | `8000` | `80` | Serves the built React app; proxies `/api/*` to the backend. |
| `backend` | Node 20 | `8001` | `3000` | Business logic, auth, importers, categorization, aggregates. |
| `postgres` | PostgreSQL 16 | `5432` (loopback) | `5432` | Persistence. Uses `pg_trgm`, `unaccent`, `pgcrypto`. |
| `mcp` (optional) | Node 20 | not exposed | — | LLM tool surface. Encrypts payloads with a per-user token. |

Frontend and backend listen on every host interface so other devices
on your LAN can reach the app. Postgres binds to `127.0.0.1` only —
the backend reaches it via the compose network, and nothing outside
the host should touch it.

## Request flow: "user imports an OFX file"

Follow one operation end-to-end so the layers become concrete.

1. **Browser** — the user drops `bnp_2026-06.ofx` on the Imports page.
   The frontend `POST`s the file to `/api/imports`.
2. **Frontend proxy** — nginx forwards the request to the backend
   container at `http://backend:3000/api/imports`.
3. **Backend auth plugin** — verifies the session cookie
   (`backend/src/http/plugins/auth.ts`), rotates the session id on
   login (not on every request), and attaches the user id to the
   request.
4. **Backend import route** — reads the file, sniffs the encoding,
   detects the format (OFX in this case), and hands off to the OFX
   parser in `backend/src/domain/imports/`.
5. **OFX parser** — yields a stream of candidate transactions with
   normalised labels (accent-folded, case-folded for full-text
   search).
6. **Categorization pass** — each candidate is run through the user's
   rule set (`backend/src/domain/rules/`). Matches get a `category_id`;
   non-matches stay `NULL` and land in the Tri tab.
7. **Deduplication + insert** — the backend computes a content
   signature for each candidate and asks Postgres to insert with an
   `ON CONFLICT` clause on the signature. New rows land; duplicates
   increment the "read but deduped" counter.
8. **Audit row** — an `imports` row records the file hash, count of
   inserted / skipped / errored, and the timestamp. Re-uploading the
   same file is a no-op.
9. **Response** — the backend replies with the per-file summary; the
   frontend renders it under the drop zone.

For PDFs, step 5 is replaced by the template wizard flow (see the
user-facing [Importing](../users/importing.md) page); everything else
is the same.

## Key libraries

- **Fastify 5** — HTTP framework. Chosen for its schema-first route
  validation and low overhead.
- **Drizzle ORM** — typed SQL. The schema lives in
  `backend/src/db/schema.ts` and doubles as the type source for API
  responses.
- **TanStack Query** — server state on the frontend. Every API call
  is a `useQuery` or `useMutation`; caching and background refetch
  are handled by the library.
- **Tailwind 3** — utility CSS. No component library; the design
  system lives in `frontend/src/components/`.
- **PostgreSQL extensions:**
  - `pg_trgm` — trigram indexes for full-text search.
  - `unaccent` — accent folding at query time.
  - `pgcrypto` — random secrets and the MCP payload encryption.
- **`argon2` (argon2id mode)** — password hashing. Per-user salt,
  OWASP 2024 parameters (19 MiB memory, 2 iterations, parallelism 1).
- **Hand-written SQL migrations** — files under
  `backend/src/db/migrations/`, applied in lexicographic order at
  server boot, tracked in a `schema_migrations` table. Each file
  runs in its own transaction.

## Observability

The backend exposes Prometheus metrics at `GET /metrics` on the same
port as the API — no auth (LAN-only), rate-limited to 20 requests per
minute per client IP. See the top-level README's *Metrics* section
for the labels and canonical scrape config.

## Where to go next

- **[Code map](code-map.md)** — where things live in the tree.
- **[Development](development.md)** — how to run the stack locally
  and where the tests are.
- **[Database](database.md)** — schema highlights and migration
  workflow.

← [Back to contributor docs](README.md)
