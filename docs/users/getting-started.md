---
title: Getting started
sidebar_position: 2
---

# Getting started

:::tip Try before you install
An interactive demo runs in your browser — no account, no install.
All data stays local (localStorage), and a **Reset the demo** button
restores the original dataset.
[Open the demo →](./demo)
:::

Athena ships in two flavours from the same codebase. Pick the one that
matches how you want to use it — both stay local, neither talks to the
cloud, and your data never leaves the machine you install it on.

## Pick a path

<table>
  <thead>
    <tr>
      <th>Family server (Docker)</th>
      <th>Solo user (Desktop)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Runs as a small stack (Postgres + Fastify + nginx) on a machine
          you leave on — a NAS, a mini-PC, a spare laptop. Everyone in
          the household reaches it over the LAN in a browser.</td>
      <td>A single desktop application on macOS, Windows, or Linux. You
          double-click it, a window opens, and everything runs inside
          that process on your own machine.</td>
    </tr>
    <tr>
      <td>Multi-user with real login sessions. Handles concurrent
          imports and dashboards from several devices.</td>
      <td>Single-user. The onboarding password unlocks the app locally;
          no network login flow.</td>
    </tr>
    <tr>
      <td>Requires Docker and Docker Compose on the host.</td>
      <td>No prerequisites. Download, install, launch.</td>
    </tr>
    <tr>
      <td>Data lives in a Postgres volume you control.</td>
      <td>Data lives in a per-OS user directory as a single PGlite
          file — easy to copy for backup.</td>
    </tr>
    <tr>
      <td>➜ Continue below.</td>
      <td>➜ Jump to <a href="desktop-install.md"><strong>Desktop install</strong></a>.</td>
    </tr>
  </tbody>
</table>

Both paths share the same features, the same UI, the same backup format,
and the same MCP endpoint — the only real differences are the ones in
the table above. You can move a backup export between them freely.

The rest of this page walks the **Docker** path. If you picked desktop,
head to **[Desktop install](desktop-install.md)** and then come back for
[Your first ten minutes](#your-first-ten-minutes) — that section applies
to both paths unchanged.

## Docker path — what you need

- A Linux or macOS host with Docker and Docker Compose. Windows works
  under WSL 2 but is not the primary target.
- The ports `8000` (frontend), `8001` (backend), and `5432`
  (PostgreSQL) free on `127.0.0.1`. Frontend and backend bind to every
  host interface by default so other devices on your LAN can reach the
  app; Postgres stays on loopback because the backend reaches it via
  the compose network.
- A modern browser.

Athena does **not** need a domain name, TLS certificates, or a public
IP. It runs on your LAN and stays there.

## Install

Clone the repo and run the install script:

```bash
git clone https://github.com/Gekkotron/Athena-Accounting.git
cd Athena-Accounting
./install.sh
```

`install.sh` generates a `.env` file with strong random secrets
(session key, DB password) and locks it to mode `600`. It does **not**
create a user; you do that on first visit.

Then bring the stack up — two options:

### Option A — prebuilt images (recommended)

Every [release](https://github.com/Gekkotron/Athena-Accounting/releases)
publishes multi-arch (amd64 + arm64) Docker images to GHCR, so the host
needs no Node and compiles nothing:

```bash
./update-release.sh
```

The script resolves the newest published version from GitHub, pins it
as `ATHENA_VERSION` in `.env`, pulls the images, starts the stack
(`docker-compose.release.yml`), and waits for the backend to report
healthy. Re-run it any time to update.

Two `.env` settings worth knowing:

- `ATHENA_VERSION` — the pinned version. The script manages it, but you
  can set it by hand to any tag from the releases page.
- `TZ` (e.g. `TZ=Europe/Paris`) — without it the containers run on UTC,
  so schedule-based features (the bank-sync retrieval hour) fire at UTC
  hours instead of your wall-clock time.

### Option B — build from source

```bash
docker compose up --build
```

The first build is slow (Node install, Postgres extensions); later
starts are fast. Pick this to audit or modify the code you run —
otherwise Option A gives the same stack in a fraction of the time.

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

## First-run onboarding

The first visit shows an onboarding screen instead of a login form. It
asks for a username and password.

- Your password is hashed with **argon2id** (per-user salt, OWASP
  2024 parameters) before anything touches the database. The raw
  password is never stored.
- The onboarding endpoint is protected by an **anti-takeover lock**:
  once the first user is created, any further onboarding attempt is
  refused. This prevents someone on your LAN from beating you to your
  own instance.

Pick a strong password and store it in a password manager. Athena has
no "forgot my password" email flow because it doesn't send email.

## Updating

Two scripts, one per install flavour — both run from the checkout
directory and both leave your Postgres data untouched:

**Prebuilt images** (`docker-compose.release.yml`):

```bash
./update-release.sh
```

It resolves the newest published release from the GitHub API (latest
stable once one exists; the newest RC until then), writes a `pg_dump`
safety backup into `./backups/`, pins `ATHENA_VERSION` in `.env`, pulls
the images, restarts the stack, and waits for `/health`. Re-running when
already up to date exits early. `--no-backup` skips the dump.

**Built from source** (`docker-compose.yml`):

```bash
./update.sh
```

`update.sh` runs a fast-forward `git pull --rebase`, rebuilds the
`backend` and `frontend` containers with `--no-cache`, brings the stack
back up in the background (`docker compose up -d --build`), and prunes
any dangling images left over by the rebuild. Postgres is a stock image
and is **not** rebuilt, so your data volume is preserved untouched.

The script is safe to re-run — if there are no new commits and both
containers are already up, it exits early without touching anything. If
the pull brought no changes but a container is stopped, it starts it.

### Migrating a source install to prebuilt images

Already running the stack built from source? `./update-release.sh`
performs the whole switch in one run: it writes a `pg_dump` backup,
pins the newest version, pulls the images, and swaps the app containers
in place. Postgres keeps running on the same `./postgres-data`
directory and your `.env` is reused — keep `SESSION_SECRET` unchanged
(it encrypts stored bank-sync credentials), and never run
`docker compose down -v`.

You can wire it to a cron for a light-touch homelab auto-update; a
sensible cadence is once a day off-peak:

```cron
0 4 * * * /path/to/Athena-Accounting/update.sh >> /var/log/athena-update.log 2>&1
```

Desktop users update by downloading the latest installer from the
[Releases page](https://github.com/Gekkotron/Athena-Accounting/releases)
and running it over the existing app — the data directory is untouched.

## Your first ten minutes

Once you're logged in:

1. **Create an account.** *Accounts → Add*. Give it a name,
   currency, opening balance, and opening date. Every reported balance
   is computed as `opening_balance + SUM(amount WHERE date >= opening_date)`,
   so getting the opening pair right matters. If you're not sure of
   the value, use the earliest balance visible on your bank statement
   — you can correct it later with a balance checkpoint.

2. **Import a statement.** *Imports → drop file*. OFX and CSV import
   immediately. The first PDF from a new bank opens the template
   wizard — see **[Importing](importing.md)**.

3. **Look at the dashboard.** You'll see a balance chart, a category
   donut (mostly empty at first — everything is uncategorised), and an
   insights panel.

4. **Categorize a few transactions.** *Tri → click a keyword →
   "Generate a rule"*. Every future transaction matching that
   keyword will be categorised automatically. See
   **[Categorization](categorization.md)** for the details.

5. **Set a budget** (optional). *Budgets → pick a category → set a
   monthly amount*. The Dashboard shows planned vs actual.

## Where to go next

- **[Importing](importing.md)** — the flagship feature, especially the
  PDF template wizard.
- **[Categorization](categorization.md)** — how the rules engine works.
- **[Dashboard](dashboard.md)** — the widgets in depth.
- **[Accounts & data](accounts-and-data.md)** — do a backup export
  before you have a lot of data to lose.

← [Back to user docs](README.md)
