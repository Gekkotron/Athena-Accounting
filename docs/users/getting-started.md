# Getting started

This page takes you from an empty machine to a running Athena instance
you're actively using. It should take about ten minutes.

## What you need

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

Bring the stack up:

```bash
docker compose up --build
```

The first build is slow (Node install, Postgres extensions). Later
starts are fast.

Open <http://127.0.0.1:8000>.

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

## Your first ten minutes

Once you're logged in:

1. **Create an account.** *Comptes → Ajouter*. Give it a name,
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
   "Générer une règle"*. Every future transaction matching that
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
