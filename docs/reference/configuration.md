---
title: Configuration
sidebar_position: 2
---

# Configuration

Athena reads its configuration from environment variables at boot and from
per-user settings stored in the database. This page enumerates both, plus
the default network ports the three services listen on.

## Environment variables

All defaults below are the values Athena falls back to when the variable is
unset. Copy `.env.example` to `.env` before starting `docker compose up` and
fill in the fields marked **required**.

### PostgreSQL (`db` service)

| Variable | Default | Effect |
| --- | --- | --- |
| `POSTGRES_USER` | `athena` (placeholder) | **Required.** Database role the backend connects as. Also used by the Postgres image at initdb time. |
| `POSTGRES_PASSWORD` | *(none)* | **Required.** Password for `POSTGRES_USER`. Never leave the placeholder in production. |
| `POSTGRES_DB` | `athena` | Database name created on first boot. |

### Backend (`backend` service)

| Variable | Default | Valid values | Effect |
| --- | --- | --- | --- |
| `SESSION_SECRET` | *(none)* | ≥ 32 characters | **Required.** Signs the session cookie and derives the MCP payload encryption key. Generate with `openssl rand -hex 32`. Rotating it invalidates every session and every encrypted MCP endpoint. |
| `DATABASE_URL` | *(none)* | Postgres URL | **Required when `DB_DRIVER=postgres`.** Full connection string, e.g. `postgres://athena:…@db:5432/athena`. |
| `COOKIE_SECURE` | `false` | `true` / `false` / `1` / `0` | Marks the session cookie as `Secure`. Leave `false` on a plain-HTTP LAN deployment — otherwise the browser rejects the cookie and login silently fails. Set to `true` when running behind an HTTPS-terminating reverse proxy. |
| `NODE_ENV` | `development` | `development` / `production` / `test` | Controls Fastify logging (`pino-pretty` in development, JSON otherwise) and enables the built-in static file server when `SERVE_STATIC` is unset. Docker Compose sets this to `production`. |
| `PORT` | `3000` | integer | Port Fastify listens on inside the container. Docker Compose maps `BACKEND_PORT` on the host to this port. |
| `DB_DRIVER` | `postgres` | `postgres` / `pglite` | Selects the SQL backend. `postgres` uses `pg.Pool` (Docker path). `pglite` uses embedded Postgres-in-WASM (Tauri desktop, test path). |
| `PGLITE_PATH` | *(unset — in-memory)* | filesystem path | Only used when `DB_DRIVER=pglite`. When set, PGlite persists to this directory; unset means an ephemeral in-memory database. |
| `AUTH_MODE` | `session` | `session` / `none` | `session` is the LAN/Docker path: cookies + argon2id passwords, users register through onboarding. `none` disables auth entirely — every request is authenticated as a single hard-coded local user. **Never enable `none` on anything other than a strictly loopback-only deployment.** |
| `SERVE_STATIC` | *(unset — mirrors `NODE_ENV=production`)* | `true` / `false` / `1` / `0` | When true, Fastify also serves the built frontend from `STATIC_ROOT`. Used by the Tauri sidecar; Docker Compose keeps nginx in front instead. |
| `STATIC_ROOT` | `<cwd>/frontend/dist` | filesystem path | Directory Fastify serves the SPA from when `SERVE_STATIC` is enabled. |
| `DATA_DIR` | `/data` (Docker) / CWD (dev) | filesystem path | Root directory for user data: the PGlite file, backups, and uploads. The Tauri entry point overrides this to the OS-specific per-user data directory. |
| `OCR_LANG_PATH` | *(unset — CDN fetch)* | filesystem path | Local path to Tesseract language files. When unset, the first OCR run downloads them from a CDN, which fails on a LAN-only deployment. Docker builds bundle the files and set this variable automatically. |

### Frontend (build-time, Vite)

The frontend is a static bundle — these variables are read at `npm run build`
time by Vite and inlined into the resulting `dist/`, not read at runtime.

| Variable | Default | Effect |
| --- | --- | --- |
| `VITE_DEMO` | *(unset)* | When set to `1`, `npm run build` produces `frontend/dist-demo/` instead of `frontend/dist/`. The bundle routes every API call through a browser-only adapter backed by seed data — no backend required. Used to publish the public GitHub Pages demo. |

### Host ports (compose overrides)

| Variable | Default | Effect |
| --- | --- | --- |
| `FRONTEND_PORT` | `8000` | Host port mapped to the frontend container's port 80. Bound to `0.0.0.0` so other devices on your LAN can reach the app. |
| `BACKEND_PORT` | `8001` | Host port mapped to the backend container's port 3000. Bound to `0.0.0.0` for direct API testing; the frontend proxies `/api/*` calls through nginx in production. |

Avoid `6000`, `6666`, `6665–6669`, and `6697` — Chrome blocks them as
`ERR_UNSAFE_PORT`.

## Default network ports

| Service | Host port | Container port | Bind |
| --- | --- | --- | --- |
| Frontend (nginx) | `${FRONTEND_PORT:-8000}` | `80` | `0.0.0.0` (LAN-reachable) |
| Backend (Fastify) | `${BACKEND_PORT:-8001}` | `3000` | `0.0.0.0` (LAN-reachable) |
| PostgreSQL | `5432` | `5432` | `127.0.0.1` only (never on the LAN) |

Comment out the `db` service's `ports:` block in `docker-compose.yml` if you
don't need Postgres reachable from the host at all — the backend talks to
it over the compose network regardless.

## Per-user settings (Settings page)

These persist in the `users.settings` JSON column and are edited from the
Settings page. They're per-user, not per-installation. The backend seeds the
defaults on first save; the frontend paints these same defaults while the
first fetch is in flight (source: `frontend/src/lib/settings.ts`).

| Setting | Default | Valid values | Effect |
| --- | --- | --- | --- |
| Default range (`dashboardRange`) | `3m` | `30d`, `3m`, `6m`, `12m`, `all` | Time window the Dashboard opens with on every load. The Range picker still overrides it inside a session. |
| Default account scope (`dashboardChartScope`) | `all` | `all` or an account id | Which account(s) the Dashboard charts scope to on load. `all` aggregates every account. |
| Dashed-line gap threshold (`chartGapThresholdDays`) | `6` | positive integer (days) | On the balance-over-time chart, gaps between consecutive points larger than this are drawn as a dashed line — a visual cue that data may be missing (e.g. a period with no imports). |
| Duplicate similarity threshold (`duplicateSimilarityThreshold`) | `0` | integer 0–100 | Default filter on the "Possibles doublons" list under Data → Duplicates. Groups whose label similarity is below this threshold are hidden. `0` shows every candidate group. |

*See also:* [Getting started](/docs/users/getting-started) ·
[Security and privacy](/docs/users/security-and-privacy)

← [Back to reference index](README.md)
