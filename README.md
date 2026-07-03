# Athena Accounting

[![CI](https://github.com/Gekkotron/Athena-Accounting/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Gekkotron/Athena-Accounting/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/Gekkotron/Athena-Accounting/graph/badge.svg?token=Im41zFoBmH)](https://codecov.io/gh/Gekkotron/Athena-Accounting)

Self-hosted personal accounting. Local-only, no cloud dependencies, your
bank data never leaves your network.

- Import OFX (SGML, Latin-1 or UTF-8) and French CSV statements
- Database-level deduplication on re-imports
- Configurable rule engine for automatic categorisation, with sign guards
  and accent/case-insensitive word matching
- Internal transfer detection (the two legs are linked and excluded
  from income/expense aggregates)
- Bulk "Tri" tab for the long tail of uncategorised transactions, with
  on-the-fly rule generation
- Multi-currency, multi-account, with opening-balance discipline
- Argon2id-hashed first-run onboarding; session cookie auth
- Per-user configurable defaults (dashboard range, chart account, chart
  gap threshold, duplicates similarity threshold) via the Réglages page

## Stack

- **Backend:** Node 20 + Fastify 5 + TypeScript + Drizzle ORM
- **Database:** PostgreSQL 16 (`pg_trgm`, `unaccent`, `pgcrypto`)
- **Frontend:** React 18 + Vite + Tailwind 3 + TanStack Query
- **Packaging:** single `docker-compose.yml` (postgres + backend + frontend)

## Quickstart

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
| GET    | `/api/reports/balance`                | Totals per currency.                   |
| GET    | `/api/reports/timeseries`             | Per-account running balance.           |
| GET    | `/api/reports/categories`             | Per-category monthly aggregates.       |
| GET PATCH | `/api/settings`                    | Per-user defaults (JSONB blob).        |

## Migrations

Hand-written SQL in `backend/src/db/migrations/*.sql`, applied in
lexicographic order at server boot, tracked in a `schema_migrations`
table. Each file runs in its own transaction; nothing skipped, nothing
re-run. You can also use `drizzle-kit` (`cd backend && npm run db:generate`)
to emit the next migration from `schema.ts`; the runner ignores the
journal file Drizzle creates alongside.

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
