# Security Policy

## Reporting a vulnerability

If you believe you've found a security vulnerability in Athena Accounting,
please report it privately rather than opening a public issue.

- **Contact:** `60887050+Gekkotron@users.noreply.github.com`
- Include a description of the issue, reproduction steps, affected version(s),
  and any relevant logs or proof-of-concept material.
- Please do not disclose the vulnerability publicly until a fix has been
  released or the coordinated-disclosure window has elapsed.

## Coordinated disclosure

This project follows a **90-day coordinated-disclosure window** starting from
the date the report is acknowledged. After 90 days, reporters are free to
disclose publicly, whether or not a fix has shipped.

## No SLA

Athena Accounting is a **solo-maintainer, open-source project** with no paid
support and no service-level agreement. Reports will be triaged on a
best-effort basis, and response times may vary. Critical issues are
prioritized, but there is no guaranteed time-to-fix.

## Supported versions

Only the latest release on `main` receives security fixes. Older tags and
pre-release builds are not maintained.

## Threat model

Athena Accounting is designed as a **single-tenant, LAN-only** deployment
(a home mini-PC, an intranet server, or similar). By default:

- The frontend and backend containers bind to **every host interface**
  (`0.0.0.0`) so other devices on your LAN can reach the app at
  `http://<host-ip>:<port>`. If that's not what you want, restrict with a
  host firewall — or edit `docker-compose.yml` and prefix the port
  mappings with `127.0.0.1:` (e.g. `127.0.0.1:8000:80`) and put a
  reverse proxy in front for remote access.
- Onboarding registration is **open by design**: any client that can
  reach the app can create the first user. On a LAN-exposed deployment,
  that means anyone on your network can register an account. Firewall
  the ports, disable onboarding after your first user, or put an
  authenticating reverse proxy in front if you need stricter access.
- Sessions are cookie-based with `httpOnly`; set `COOKIE_SECURE=true`
  behind an HTTPS-terminating reverse proxy so the cookie isn't
  transmitted over plain HTTP.

The project is **not** intended to be reachable from the public internet
without an authenticating reverse proxy (Tailscale, Cloudflare Access,
nginx basic-auth, etc.) between it and the outside world.

## Third-party network calls

Athena is designed to run without egress to the public internet. The only
subsystem that *can* reach out on its own is OCR:

- **tesseract.js** downloads `fra.traineddata` / `eng.traineddata` (~30 MB
  each) from a CDN the first time OCR runs, unless the `OCR_LANG_PATH`
  env var is set to a local directory containing those files. The
  backend logs a one-shot warning on startup-first OCR to stderr when
  the variable is missing. To stay fully offline, download the files
  once from tesseract-ocr's tessdata_fast release and point
  `OCR_LANG_PATH` at their directory.

Everything else — categorization, budgeting, imports, reports — is
computed locally against your Postgres. No telemetry, no analytics, no
LLM calls unless you explicitly wire the MCP endpoint yourself.
