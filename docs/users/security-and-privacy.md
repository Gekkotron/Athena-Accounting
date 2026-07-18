---
title: Security and privacy
sidebar_position: 7
---

# Security and privacy

Athena is designed to run on your own machine and stay there. There is no
cloud, no telemetry, no third-party analytics — the only network traffic
Athena initiates is the one you ask for (an import, a backup export, an MCP
call to a model you connect yourself).

## Security model

**LAN-only by default.** The Docker Compose stack binds the frontend and
backend to your host, and the recommended posture is to keep Athena reachable
from your home network only — behind your router, not exposed to the public
internet. The Tauri desktop build goes one step further: it binds to
`127.0.0.1` on a random port and is unreachable from any other machine.

**Authentication.** The session-based auth path (`AUTH_MODE=session`, the
Docker default) uses `@fastify/session` with a signed cookie. On successful
login the session id is regenerated (`req.session.regenerate()`) to prevent
session fixation, and `/api/auth/logout` destroys the session server-side.
Login is rate-limited by `@fastify/rate-limit` to slow down brute-force
attempts against weak passwords.

**Password hashing.** Passwords are hashed with **argon2id** via
`@node-rs/argon2` using the OWASP 2024 minimum parameters (19 MiB memory,
2 iterations, parallelism 1) and a per-user random salt. Neither the raw
password nor a reversible representation is ever stored.

**First-run anti-takeover.** Onboarding creates the first user account and
then locks the endpoint — subsequent visitors cannot register a new
administrator over the top of yours. Add extra users from the Réglages
page once you're signed in.

**Desktop path.** The Tauri build runs with `AUTH_MODE=none`: no cookies,
no login screen, a single hard-coded local user is seeded on first boot.
That trade-off is safe because the backend never leaves `127.0.0.1` — no
other process on the LAN can reach it.

## Network boundary

**Postgres bound to 127.0.0.1.** In the shipped Docker Compose file the
Postgres service is not exposed on `0.0.0.0` — its port is bound to the
loopback interface so that the database is reachable from the backend
container over the internal Docker network but not from other machines on
your LAN. The only surface intentionally reachable from the LAN is the
frontend's HTTP port. See
[Configuration reference](../reference/configuration.md) for the exact
port defaults.

**MCP endpoint.** `/api/mcp/rpc` is the one route intended to accept
remote calls from a model runtime (Claude Desktop, Cursor, etc.). It is
gated by a per-user bearer token you mint from Réglages → MCP; every token
is encrypted at rest using `pgcrypto` and the request/response envelope is
encrypted with the same key so an inspector on the wire only sees ciphertext.
Revoking a token from Réglages invalidates it immediately.

## Backups are cleartext

Athena's backup export (`/api/backup/export`, or the button on the Data
tab) writes a JSON envelope containing every account, transaction,
category, rule, budget, and checkpoint in the clear. That's intentional —
it makes disaster recovery trivial and lets you diff historical exports
with any text tool — but it means the backup file is as sensitive as the
database itself. Store it somewhere you'd store a password manager export:
an encrypted disk image, an encrypted external drive, or a personal cloud
folder that is itself encrypted at rest. Do not email it to yourself in
the clear.

See [Backup and recovery](backup-recovery.md) for the full round-trip and
the corrupt-file recovery playbook.

## Privacy stance

- **No telemetry.** Athena does not phone home. No usage metrics, no crash
  reports, no "anonymous" analytics beacon — nothing leaves your machine
  unless you initiate it.
- **No third-party analytics.** The frontend loads no Google Analytics,
  Plausible, Segment, Sentry, or equivalent. There are no third-party
  scripts on any page.
- **No cloud.** There is no Athena backend service, no shared account
  system, no "sign in with Athena." Every install is self-contained.
- **Your data stays yours.** The database file lives in your `DATA_DIR`
  (see [Configuration reference](../reference/configuration.md)); backups
  land wherever you point them. Uninstalling Athena and deleting that
  directory is a complete data wipe.

## See also

- [Backup and recovery](backup-recovery.md) — export, restore, and recover
  from a corrupt database.
- [Configuration reference](../reference/configuration.md) — the env vars
  behind auth, session, network binding, and data directory choices.

← [Back to user docs](README.md)
