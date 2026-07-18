# Athena Accounting

[![CI](https://github.com/Gekkotron/Athena-Accounting/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Gekkotron/Athena-Accounting/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/Gekkotron/Athena-Accounting/graph/badge.svg?token=Im41zFoBmH)](https://codecov.io/gh/Gekkotron/Athena-Accounting)

Self-hosted personal accounting. Local-only, no cloud dependencies, your
bank data never leaves your network.

## Try the demo

[![Try the demo](https://img.shields.io/badge/Try%20the%20demo-in%20your%20browser-8b5cf6?style=for-the-badge)](https://gekkotron.github.io/Athena-Accounting/demo/)

A fully interactive Athena runs directly in your browser — no account,
no install, no server. All state lives in `localStorage`; a **Reset
demo** button restores the seed. Open it to walk the dashboard,
categorise transactions, and see budgets against six months of
plausible French bank data.

## Install

Two supported paths from the same codebase — pick the one that matches
how you want to use Athena:

[![Docker install](https://img.shields.io/badge/Install-Docker%20%28family%20server%29-2496ed?logo=docker&logoColor=white)](docs/users/getting-started.md)
[![Desktop install](https://img.shields.io/badge/Install-Desktop%20app%20%28solo%20user%29-4b8bbe?logo=tauri&logoColor=white)](docs/users/desktop-install.md)
[![Latest release](https://img.shields.io/github/v/release/Gekkotron/Athena-Accounting?label=Latest%20release&color=brightgreen)](https://github.com/Gekkotron/Athena-Accounting/releases/latest)

- **Family server (Docker).** Runs the full stack (Postgres + Fastify +
  nginx) on a machine you leave on. Multi-user, LAN-wide, everyone in
  the household reaches it in a browser. See the
  [Quickstart](#quickstart-docker) below.
- **Solo user (Desktop).** A single `.dmg` / `.exe` / `.AppImage` you
  download and launch. Single-user, everything runs in-process with an
  embedded PGlite database — no Docker, no other prerequisites. See
  the [desktop install guide](docs/users/desktop-install.md).

Both paths ship the same features, the same UI, and the same backup
format. You can move a backup export between them freely.

## Documentation

Read the docs online at
**<https://gekkotron.github.io/Athena-Accounting/docs/users/getting-started>**
— the same content also lives in [`docs/`](docs/README.md) in the repo,
split into a user track (install, importing, dashboard, security), a
contributor track (architecture, code map, development, database), and
a reference bucket (configuration, API, glossary).

## Features

**Imports** — the core of Athena

- Import OFX (SGML, Latin-1 or UTF-8), French CSV, and PDF bank
  statements. The first PDF from a new bank opens an interactive template
  wizard (paint the amount/date/label zones once); every later statement
  in the same format imports automatically.
- Multi-account PDF templates: content-based page filtering derives the
  account anchor and cut markers, survives pdfjs line fragmentation and
  cross-statement header re-wording, with a manual "mine / other account"
  selector and an auto-recovery re-train when a saved template stops
  matching.
- Folder or multi-file upload, processed sequentially with a per-file
  summary (inserted / skipped / needs-template / errored).
- Database-level deduplication on re-imports, plus an import audit trail
  and a "read but deduped" count in each import summary.

**Categorisation**

- Configurable rule engine with sign guards and accent/case-insensitive
  word matching; retroactive re-application preserves manual overrides.
- Bulk "Tri" tab for the long tail of uncategorised transactions, with
  on-the-fly rule generation from a keyword assignment.
- Internal transfer detection: the two legs are linked (`transfer_group_id`)
  and excluded from income/expense aggregates.
- Colour-coded category kinds (expense / income / neutral).

**Transactions**

- Accent- and case-insensitive full-text search across raw label,
  normalised label, memo and notes.
- Transaction splits (ventilation): sub-lines whose sum is forced to equal
  the parent amount by a deferrable DB trigger.
- Bulk select + bulk delete, inline category edit, and a "possible
  duplicates" panel with a configurable similarity threshold.

**Accounts & dashboard**

- Multi-currency, multi-account, with opening-balance discipline and
  drag-to-reorder.
- Locked money (PEA / dépôt à terme): the hero shows "Disponible" with a
  "+ X€ bloqués" tag until the lock matures.
- Balance checkpoints: record an expected balance from a statement; the
  dashboard chart marks it with a diamond that turns amber and draws a
  dotted line when the running total drifts by more than one cent.
- Balance chart with a calendar X-axis, brush-to-zoom, and configurable
  dotted gap segments; category donut and account/range filters.
- Privacy mode blurs amounts after inactivity.
- Optional per-category monthly budgets on a dedicated Budgets screen:
  planned-vs-actual bar per expense category for a chosen month, red when over.

**Data & settings**

- Backup export / import (accounts, transactions, checkpoints, splits).
- Per-user configurable defaults (dashboard range, chart account, chart
  gap threshold, duplicates similarity threshold) via the Réglages page.

**Security**

- Argon2id-hashed first-run onboarding; session cookie auth with login
  rate-limiting, session-id rotation, and an anti-takeover onboarding lock.

**MCP access**

- Optional local Model Context Protocol server: let a local LLM (e.g. Ollama
  via an MCP client) create, update, delete, and search transactions. Content
  is encrypted end-to-end with a per-user token — nothing travels the LAN in
  plaintext. See [docs/users/mcp.md](docs/users/mcp.md).

## Stack

- **Backend:** Node 20 + Fastify 5 + TypeScript + Drizzle ORM
- **Database:** PostgreSQL 16 (`pg_trgm`, `unaccent`, `pgcrypto`)
- **Frontend:** React 18 + Vite + Tailwind 3 + TanStack Query
- **Packaging (family-server path):** single `docker-compose.yml`
  (postgres + backend + frontend).
- **Packaging (desktop path):** Tauri 2 shell + directory-based sidecar
  (bundled Node runtime + Fastify + PGlite). Same backend code, no
  Docker required.

## Quickstart (Docker)

> Prerequisite: Docker and Docker Compose on the host. If you don't
> want Docker in the picture at all, use the
> [desktop app](docs/users/desktop-install.md) instead — no
> prerequisites, no LAN, single user.

```sh
./install.sh                  # generates .env with strong random secrets
docker compose up --build
```

Open <http://127.0.0.1:8000> — the first visit walks you through creating
your username and password. Your password is hashed with argon2id
(per-user salt) before being stored; only the hash ever touches the
database.

Default host ports (both bound to `127.0.0.1`):

| Service  | Host port | Container port | Listener         |
|----------|-----------|----------------|------------------|
| frontend | 8000      | 80 (nginx)     | all host IPs     |
| backend  | 8001      | 3000           | all host IPs     |
| postgres | 5432      | 5432           | 127.0.0.1 only   |

Frontend and backend listen on every host interface so other devices on your
LAN can reach the app (`http://<server-lan-ip>:8000`). Postgres stays bound
to loopback because the backend reaches it via the compose network — nothing
outside the host should touch it.

Override via `FRONTEND_PORT` / `BACKEND_PORT` in `.env`. Avoid 6000, 6665–6669,
and 6697 — Chrome blocks them as `ERR_UNSAFE_PORT`.

If you actually want the app to stay loopback-only (single-machine access),
prefix the port mappings in `docker-compose.yml` with `127.0.0.1:`.

## Configuration env vars

`install.sh` writes random values for the secrets; you can edit `.env`
freely if you want to customise.

| Variable             | Default | Meaning                                                                 |
|----------------------|---------|-------------------------------------------------------------------------|
| `POSTGRES_USER`      | athena  | DB user.                                                                |
| `POSTGRES_PASSWORD`  | random  | Generated.                                                              |
| `POSTGRES_DB`        | athena  | DB name.                                                                |
| `SESSION_SECRET`     | random  | ≥ 32 chars. Used to sign the session cookie.                            |
| `COOKIE_SECURE`      | false   | Set to `true` only behind an HTTPS-terminating reverse proxy.           |
| `FRONTEND_PORT`      | 8000    | Host port for the SPA.                                                  |
| `BACKEND_PORT`       | 8001    | Host port for the Fastify API.                                          |

## Importing a statement

1. Create the destination account in **Comptes** (the opening balance +
   opening date are mandatory — every reported balance is computed as
   `opening_balance + SUM(amount WHERE date >= opening_date)`).
2. *(Optional)* add filename patterns in the same tab so the importer
   resolves the target account automatically.
3. In **Imports**, upload your `.ofx` / `.qfx` / `.csv` / `.pdf` file. The
   response surfaces inserted vs deduped counts — a "0 inserted" outcome
   on a re-import means the dedup keys matched, not that anything went
   wrong. For PDFs, the first import of a new bank format opens a small
   wizard to define the table layout once; future imports of the same
   format go through automatically.

CSV format the parser expects:

- separator `;` (auto-detected, `,` also tried)
- decimal `,`
- dates `JJ/MM/AAAA`
- a date column, a label column, and either a `Montant` column or a
  `Débit` + `Crédit` pair (header names are matched accent/case-insensitively)

OFX: SGML-style (tags without closing tags) is handled, both
Windows-1252 and UTF-8 are detected from the OFX header.

## Internal transfers

Configure pairs of keywords in **Règles** → *(coming, transfer rules
endpoint is `/api/transfer-rules` — UI page will appear in v2 if you
need it)*. The importer annotates matching transactions, then looks for
the mirror leg in the counterpart account within ±7 days. Found legs
share a `transfer_group_id` and are excluded from income/expense
aggregates.

## Points de contrôle

Sur chaque compte (onglet **Comptes** → `▸ Points de contrôle`), vous
pouvez enregistrer un solde attendu à une date donnée (typiquement lu
sur un relevé bancaire). Le graphique du dashboard affiche un losange à
cette date; s'il dérive de plus d'un centime du cumul calculé, le
losange devient ambre et une ligne pointillée relie l'attendu au réel —
un signal purement visuel pour repérer une erreur d'import ou de saisie.

## Réglages

L'icône engrenage à côté de votre nom d'utilisateur (barre latérale)
ouvre la page **Réglages** — les valeurs par défaut chargées à chaque
visite du tableau de bord :

- Période affichée par défaut (30 j / 3 m / 6 m / 12 m / Tout)
- Compte affiché par défaut sur le graphique d'évolution
- Seuil (en jours) au-delà duquel un trou dans les données est tracé
  en pointillés
- Seuil de similarité par défaut du panneau *Possibles doublons*

Les valeurs sont stockées par utilisateur (table `user_settings`, blob
JSONB). Les changements faits en cours de session (clic sur une autre
période, choix d'un autre compte) restent locaux ; pour changer la
valeur *par défaut*, passez par Réglages.

## Project layout

```
.
├── install.sh                         # secret generator (chmod 600 .env)
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── src/
│   │   ├── server.ts
│   │   ├── env.ts
│   │   ├── db/                        # Drizzle schema + SQL migrations
│   │   ├── domain/                    # business logic
│   │   │   ├── imports/               # OFX/CSV parsers, normalise, dedup
│   │   │   ├── rules/                 # matcher + retroactive recategorize
│   │   │   └── transfers/             # internal transfer detection
│   │   └── http/
│   │       ├── plugins/auth.ts        # session cookie + argon2id
│   │       └── routes/                # one file per resource
│   └── tests/
└── frontend/
    ├── Dockerfile                     # multi-stage Vite build + nginx
    ├── nginx.conf                     # SPA fallback + /api proxy
    └── src/
        ├── App.tsx                    # route guard via /api/auth/me
        ├── api/                       # typed fetch client
        ├── components/                # Layout, BalanceChart
        ├── lib/format.ts              # currency / date helpers
        └── pages/                     # Login, Dashboard, Transactions, …
```

## API surface (auth-protected unless noted)

| Method | Path                                  | Notes                                  |
|--------|---------------------------------------|----------------------------------------|
| GET    | `/health`                             | Public. DB ping included.              |
| GET    | `/api/onboarding/status`              | Public. Reports first-run state.       |
| POST   | `/api/onboarding/create`              | Public. Creates the first user.        |
| POST   | `/api/auth/login`                     | Public.                                |
| POST   | `/api/auth/logout`                    |                                        |
| GET    | `/api/auth/me`                        |                                        |
| GET POST PUT DELETE | `/api/accounts[/…]`      |                                        |
| GET POST PUT DELETE | `/api/account-filename-patterns[/…]` |                          |
| GET POST PUT DELETE | `/api/categories[/…]`    |                                        |
| GET POST PUT DELETE | `/api/rules[/…]`         |                                        |
| GET POST PUT DELETE | `/api/transfer-rules[/…]` |                                       |
| POST   | `/api/recategorize`                   | Bulk re-apply rules (preserves manual).|
| GET    | `/api/transactions`                   | Paginated, filterable.                 |
| GET    | `/api/transactions/:id`               |                                        |
| PATCH  | `/api/transactions/:id`               | Inline category edit (→ manual).       |
| POST   | `/api/imports`                        | Multipart file upload.                 |
| GET    | `/api/imports[/:id]`                  | Import audit trail.                    |
| GET    | `/api/tri/groups`                     | Bundle un-categorised by label.        |
| POST   | `/api/tri/assign`                     | Bulk assign + optional rule creation.  |
| GET POST PUT DELETE | `/api/budgets[/…]`      | Per-category monthly limits.           |
| GET    | `/api/reports/balance`                | Totals per currency.                   |
| GET    | `/api/reports/timeseries`             | Per-account running balance.           |
| GET    | `/api/reports/categories`             | Per-category monthly aggregates.       |
| GET    | `/api/reports/budget`                 | Planned vs actual for a month.         |
| GET PATCH | `/api/settings`                    | Per-user defaults (JSONB blob).        |

## Migrations

Hand-written SQL in `backend/src/db/migrations/*.sql`, applied in
lexicographic order at server boot, tracked in a `schema_migrations`
table. Each file runs in its own transaction; nothing skipped, nothing
re-run. You can also use `drizzle-kit` (`cd backend && npm run db:generate`)
to emit the next migration from `schema.ts`; the runner ignores the
journal file Drizzle creates alongside.

## Metrics (Prometheus)

The backend exposes Prometheus metrics at `GET /metrics` on the same
port as the API. There is no authentication — the endpoint is designed
for a LAN-only deployment. Rate-limited to 20 requests per minute per
client IP; a normal Prometheus scrape is 2–4 requests per minute.

Example scrape config:

```yaml
scrape_configs:
  - job_name: athena
    metrics_path: /metrics
    scrape_interval: 30s
    static_configs:
      - targets: ['<homelab-host>:<port>']
```

Metrics of interest:

- `athena_http_requests_total{method,route,status_class}` — request
  counts.
- `athena_http_request_duration_seconds` — latency histogram.
- `athena_imports_total{kind,outcome}` — imports counted by format
  (`csv`/`ofx`/`qfx`/`pdf`/`photo`) and result
  (`success`/`error`/`aborted`).
- `athena_db_size_bytes` — Postgres database size.
- `athena_transactions_total`, `athena_accounts_total` — row counts.
- `athena_backup_last_success_timestamp_seconds` — Unix timestamp of
  the last successful `GET /api/backup/export`. Alert on
  `time() - <this> > <N days>`.
- `process_*`, `nodejs_*` — Node.js runtime metrics (from `prom-client`
  defaults): CPU, memory, event-loop lag, GC.

Labels are curated to stay public-safe: no user IDs, account IDs,
transaction IDs, hostnames, emails, or IPs ever appear in metric
labels.

## Security notes

- Both services bind to `127.0.0.1` only — there's no public listener.
- Argon2id parameters meet the OWASP 2024 minimum (19 MiB memory, 2
  iterations, parallelism 1) and a per-user salt is generated by the library.
- Login always runs an argon2 verify, even when the user does not exist,
  to prevent username enumeration via response timing.
- Session id is rotated on login (anti-fixation).
- Onboarding endpoint refuses any request after the first user is
  created (anti-takeover).

## Roadmap

- [x] Étape 1 — Architecture + schema design
- [x] Étape 2 — docker-compose + schema + `/health`
- [x] Étape 3 — Auth + onboarding + accounts CRUD
- [x] Étape 4 — OFX/CSV parsers + dedup
- [x] Étape 5 — Rule engine + retroactive recategorization
- [x] Étape 6 — Internal transfer detection
- [x] Étape 7 — Transactions API + reports
- [x] Étape 8 — Frontend: layout + dashboard + transactions + accounts + imports
- [x] Étape 9 — "Tri des catégories" tab
- [x] Étape 10 — Categories/rules UI + README polish
- [x] Étape 11 — PDF bank statement import (heuristic + interactive template)
- [x] Étape 12 — Points de contrôle (réconciliation visuelle par compte)
- [x] Étape 13 — Réglages utilisateur (défauts par compte pour le dashboard et les doublons)

## Possible next steps (v2)

- A `/transfer-rules` UI page (the API exists)
- Pie/bar charts on the dashboard (recharts or similar)
- Multi-currency conversion via a small manual FX-rate table
- Optional Ollama integration to suggest a category when no rule matches
  (LLM stays local, behind a feature flag, default off — per the original spec)

## Community

- [License (MIT)](LICENSE)
- [Security policy](SECURITY.md)
- [Contributing guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Backup and recovery](docs/users/backup-recovery.md)
