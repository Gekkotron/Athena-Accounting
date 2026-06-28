# Athena Accounting

Self-hosted personal accounting. Local-only, no cloud dependencies, your bank
data never leaves your network.

> Status: **Étape 2 / 10** — skeleton, database schema, `/health` endpoint.

## Stack

- **Backend:** Node.js 20 + Fastify 5 + TypeScript + Drizzle ORM
- **Database:** PostgreSQL 16 (with `pg_trgm` and `unaccent` extensions)
- **Frontend:** React + Vite + Tailwind (added at Étape 8)
- **Packaging:** single `docker-compose.yml`

## Quickstart

```sh
./install.sh              # generates .env with strong random secrets (chmod 600)
docker compose up --build
```

Then check the backend is healthy:

```sh
curl http://127.0.0.1:3000/health
# => {"ok":true,"ts":"..."}
```

The first time you open the app in a browser, you'll be walked through a
small onboarding to create your username and password. Your password is
hashed with argon2id (per-user salt) before being stored — only the hash
ever touches the database.

> `.env.example` is kept as documentation of available variables. Use
> `install.sh` for real installs; it never commits anything, generates
> independent secrets per install, and refuses to overwrite an existing
> `.env` (use `./install.sh --force` if you really mean to regenerate).

## Project layout

```
.
├── install.sh                         # one-shot installer (random secrets → .env)
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── drizzle.config.ts
│   └── src/
│       ├── server.ts                  # Fastify boot
│       ├── env.ts                     # env validation (zod)
│       ├── db/
│       │   ├── client.ts              # drizzle client
│       │   ├── schema.ts              # source of truth (Drizzle)
│       │   ├── migrate.ts             # bootstrap migration runner
│       │   └── migrations/            # *.sql files, applied in order
│       └── http/                      # (added at Étape 3+)
└── docs/                              # (added later)
```

## Migrations

This repo uses a simple file-based migration runner (`src/db/migrate.ts`)
rather than Drizzle's `_journal.json` plumbing. SQL files in
`backend/src/db/migrations/*.sql` are applied in lexicographic order at server
boot, tracked in a `schema_migrations` table.

You can still use `drizzle-kit` to *generate* SQL from `schema.ts` (see
`npm run db:generate` in `backend/package.json`); the runner ignores the
journal file Drizzle creates alongside.

## Roadmap

- [x] Étape 1 — Architecture + schema design
- [x] Étape 2 — docker-compose + schema + `/health`
- [ ] Étape 3 — Auth + accounts CRUD
- [ ] Étape 4 — OFX/CSV parsers + dedup
- [ ] Étape 5 — Rule engine + retroactive recategorization
- [ ] Étape 6 — Internal transfer detection
- [ ] Étape 7 — Transactions API + reports
- [ ] Étape 8 — Frontend: dashboard + transactions
- [ ] Étape 9 — "Tri des catégories" tab
- [ ] Étape 10 — Categories/rules UI + final README
