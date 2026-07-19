---
title: Troubleshooting
sidebar_position: 9
---

# Troubleshooting

Common issues and how to work around them. Each subsection follows the
same shape: what you see, why it happens, and how to fix it. If your
problem isn't listed, open an issue with your Athena version, the
smallest example that reproduces it, and the relevant lines from
`docker compose logs` (see [Gathering diagnostics](#gathering-diagnostics)).

## Startup

### Postgres port 5432 is already in use

**Symptom.** `docker compose up` fails with
`bind: address already in use` on port `5432`, or the `db` service
restarts in a loop.

**Cause.** Something else on the host is already listening on `5432` —
typically a local Postgres installed via Homebrew, `postgresql.service`,
or another compose stack.

**Fix.** Either stop the other process (`brew services stop postgresql`,
`systemctl stop postgresql`), or drop the host binding entirely — the
backend talks to Postgres over the compose network and doesn't need the
`5432` port exposed on the host. Comment out the `ports:` block on the
`db` service in `docker-compose.yml`; the stack still works, only the
`psql` from your host machine stops working.

### `.env` file missing or incomplete

**Symptom.** `docker compose up` fails with
`error while interpolating POSTGRES_USER`, or the backend container
crashes on boot with `SESSION_SECRET is required`.

**Cause.** The compose file reads secrets from `.env` at the repo root.
If you cloned the project without copying `.env.example` to `.env`,
none of the variables are set.

**Fix.**

```sh
cp .env.example .env
# then edit .env and set at least:
#   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, SESSION_SECRET
```

`SESSION_SECRET` must be a long random string — generate one with
`openssl rand -hex 32`. Restart the stack: `docker compose down &&
docker compose up -d`.

### Migration failure on first boot

**Symptom.** The `backend` container exits shortly after `db` becomes
healthy. `docker compose logs backend` shows a Prisma or Drizzle
migration error — typically `relation "…" already exists` or
`column "…" does not exist`.

**Cause.** The `postgres-data/` volume is left over from an earlier,
incompatible schema (e.g. you upgraded Athena across a breaking
migration, or you seeded the database manually).

**Fix.** For a fresh install, remove the stale volume:

```sh
docker compose down
rm -rf ./postgres-data
docker compose up -d
```

For an existing install, **do not delete the volume** — export your
data first (see [Backup and recovery](./backup-recovery)), then wipe
and restore.

## Import

### PDF template no longer matches

**Symptom.** A statement that imported fine last month now yields
"0 transactions extracted" or "template did not match".

**Cause.** Your bank changed the layout of its PDF statements — even a
one-pixel shift in a column position or a renamed header breaks the
regex-based extractor. This is the single most common import failure.

**Fix.** Open **Settings → Import → Templates**, pick the template for
that account, and re-run the "auto-detect from sample" flow with the
new PDF. If the layout is only slightly different, editing the column
anchors by hand is usually faster than starting from scratch. See
[Importing](./importing) for a walkthrough.

### OFX file imports as gibberish

**Symptom.** Transactions import, but the memo lines are full of `?`
characters or accented characters are mangled (`Ã©` instead of `é`).

**Cause.** French and Belgian banks often produce OFX files encoded in
`ISO-8859-1` (or `windows-1252`), while the OFX 1.x header declares
`UTF-8` — or declares nothing at all. Athena reads UTF-8 by default and
falls back to Latin-1 when it detects invalid UTF-8 sequences, but a
file with mixed encoding can slip through.

**Fix.** Re-encode the file before importing:

```sh
iconv -f WINDOWS-1252 -t UTF-8 statement.ofx > statement-utf8.ofx
```

Then re-import `statement-utf8.ofx`. If your bank consistently produces
Latin-1 files, flag the account in **Settings → Import → Advanced** to
force `windows-1252` decoding on every import from that source.

### CSV columns don't match

**Symptom.** The CSV import wizard shows the wrong column mapping (date
in the amount field, or the whole file on a single line).

**Cause.** Two common variants: the file uses `;` as a separator
(French bank export) but Athena guessed `,`, or the file has a header
row of prose above the actual column headers.

**Fix.** In the wizard, change the separator explicitly (`;`, `,`,
`\t`) and set "Header row" to the correct line number. Save the
mapping as a template on the account so the next import from the same
bank auto-detects it. If the file is fundamentally malformed (mixed
separators, unquoted commas inside memo fields), open it in a text
editor and clean it up before importing — Athena will not silently
guess in that case.

## Balance mismatch

You reconciled last month, but this month the computed balance no
longer matches the bank's official balance. Three causes explain
almost every mismatch.

### A transaction is missing

**Symptom.** Athena's balance is lower (or higher) than the bank's by
exactly one transaction's amount.

**Cause.** A statement covered a partial period, and one transaction
sat on the boundary of two files — either not imported at all, or
imported twice but only one instance was deleted during dedup.

**Fix.** Filter the account by the disputed date range and compare
line-by-line with the bank's statement PDF. Add the missing row via
**+ New transaction**, or delete the duplicate. Then re-run **Settings
→ Balance → Verify** to confirm the two figures match.

### A duplicate wasn't merged

**Symptom.** The same transaction appears twice, once from an OFX
import and once from a PDF import (or once from each of two overlapping
statements).

**Cause.** Athena's deduplication compares date, amount and a
normalised memo. If the two sources produced slightly different memos
(e.g. `CB CARREFOUR 12/03` vs `PAIEMENT CARTE CARREFOUR`), the
fingerprint doesn't match and the second copy is kept.

**Fix.** Open **Transactions**, sort by date, spot the pair, and
delete the one from the less-trusted source (typically the PDF —
OFX memos are usually more consistent). To prevent it happening
again, add a normalisation rule in **Settings → Rules** that rewrites
both memos to the same canonical form before dedup runs.

### Checkpoint drift

**Symptom.** The mismatch is small (a few euros or cents) and has been
present ever since a specific date.

**Cause.** A **checkpoint** — the "as of DD/MM/YYYY, the bank says the
balance is X" anchor Athena uses as its source of truth — was entered
with the wrong value, or the transactions before it were edited after
the checkpoint was set. Every displayed balance is `checkpoint + sum
of transactions after the checkpoint`, so a wrong checkpoint offsets
everything downstream.

**Fix.** Open **Settings → Account → Checkpoints**, delete the drifted
checkpoint, and re-add it with the value from a bank statement whose
date you trust. If several checkpoints are wrong, keep only the oldest
correct one — Athena recomputes from there.

## Backup and restore errors

### "Unsupported backup version"

**Symptom.** The restore fails immediately with
`unsupported backup version: v5 (this build supports up to v4)`.

**Cause.** The export was produced by a newer Athena than the one you
are restoring into. Athena refuses to open forward-versioned files —
downgrading a schema is not safe, so this is by design.

**Fix.** Upgrade the target install (`git pull && docker compose up -d
--build`, or update the desktop app) until it reaches the same version
that produced the file. Then re-run the restore.

### Restore hangs and rolls back

**Symptom.** The restore runs for a minute, then the UI shows "restore
failed, no data was changed". `docker compose logs backend` shows a
transaction rollback.

**Cause.** The restore takes a transactional lock on the current
user's rows. A second client (another tab, or an active import running
in the background) is holding a row-level lock and the restore times
out waiting for it.

**Fix.** Close every other Athena tab and cancel any running import,
then retry. The restore is idempotent — the failed run left no partial
state behind, thanks to the transaction rollback.

### `athena.db` is corrupted (desktop app)

**Symptom.** The desktop app crashes on launch with
`PGlite: database is malformed`, or the UI opens to an empty state
even though you have imported data before.

**Cause.** The PGlite file was written while the OS was shutting down,
or an antivirus quarantined it mid-write.

**Fix.** Rename the file rather than deleting it:

```sh
# macOS
mv "~/Library/Application Support/Athena Accounting/athena.db" \
   "~/Library/Application Support/Athena Accounting/athena.db.corrupt"
```

Relaunch the app, go through onboarding, then use **Settings → Data →
Restore** with your latest export. Keep the `.corrupt` file until
you've verified the restore — it's your last-resort recovery source.

## Categorization and rules

### A rule stops matching new transactions

**Symptom.** A rule that worked for months suddenly misses new
transactions from the same source. Their category stays blank in
**Transactions** and the Sort queue picks them up.

**Cause.** Your bank changed the memo format — a prefix moved, a
merchant code shifted, or an OFX importer started keeping the raw
tag where a PDF importer used to strip it. Rules match against the
*normalised* memo, so even a small change breaks the match.

**Fix.** Open **Rules → Sort**, find one of the miscategorised rows,
and click **"rule from this transaction"** — the form pre-fills
with the current normalised memo so you can widen the matcher (e.g.
switch a `startsWith` to `contains`, or accept an extra optional
suffix). Delete the stale rule once the new one covers the same span.

### The same transaction gets recategorised every time it appears

**Symptom.** You edit a transaction's category by hand, save, and the
next morning it's back to the "wrong" category — reproducibly.

**Cause.** A rule you forgot about matches this memo and runs on every
categorisation sweep, so your manual edit is overwritten. A manual
category set on a transaction that a rule also matches is treated as
"weaker" than the rule.

**Fix.** In **Rules → Rules**, filter by the memo fragment; the
offending rule surfaces at the top. Either narrow it (add an amount
band, a bank-code prefix, or an exclusion) or delete it and add a more
specific replacement. If you truly want your manual edit to stick,
promote it to a rule — it will then win over any broader matcher.

### Renaming a category leaves old transactions on the old name

**Symptom.** You rename `Courses` → `Alimentation` in the category
tree, but transactions imported before the rename still show `Courses`
in exports, and the dashboard splits the pie into two slices.

**Cause.** Categories are stored by id, not by name — so a rename
updates future references correctly, but the display in some cached
views can lag until the affected months are re-aggregated.

**Fix.** Trigger a re-render: switch the dashboard range to a
different month and back, or reload the page. If two slices persist,
you actually have two distinct category ids — merge them from
**Rules → Categories** (drag one onto the other).

## Budgets and envelopes

### An envelope is over budget by the amount of a transfer

**Symptom.** Your `Loyer` envelope should be exactly on target this
month, but the budget page shows it over by the amount of a transfer
between two of your own accounts.

**Cause.** The transfer leg didn't get tagged as an internal transfer
during import, so it's still categorised as a normal outflow and
counts against the envelope's cap.

**Fix.** Open the transaction, click **"marquer comme virement
interne"**, and pick the counterpart account. The envelope
recomputes; the pair is excluded from budget totals from now on. To
prevent it recurring, add a **Transfer rule** matching the memo and
direction (see [API endpoints](../reference/api-endpoints) → Transfer
rules).

### A category I use every month isn't in the budget view

**Symptom.** You see a category on the dashboard, but the Caps
page doesn't list it — so you can't cap it.

**Cause.** The budget view only shows categories that have at least
one plafond set (past or present). A brand-new category that's never
had a cap is invisible until you add one.

**Fix.** Open **Budgets → Caps**, click **+ Add un plafond**,
pick the category, and set a cap (even a placeholder of 0 works — the
row will appear in future months and you can adjust from there).

### Rollover from last month didn't carry over

**Symptom.** You had a positive balance in an envelope at end of
month, expected it to roll forward, but the new month starts from
zero.

**Cause.** Rollover is per-envelope, not per-category, and it's off
by default on newly-created envelopes. Categories that only have a
plafond (no envelope) never roll over — that's a plafond, not a
sinking fund.

**Fix.** Open **Budgets → Envelopes**, edit the envelope, and toggle
**"reporter le solde"**. The next month's opening balance will
include the prior month's leftover. To backfill *this* month, add a
one-off adjustment entry inside the envelope for the missing amount.

## Recurring and forecast

### Forecast page says "no confirmed series"

**Symptom.** You open **Recurring → Forecast** and see an empty state
telling you to confirm series first, even though the Detected tab
lists several.

**Cause.** The forecast only projects **confirmed** series by design
— an unconfirmed detection is a guess, and letting guesses drive a
6-month balance curve produces misleading projections. This is the
default, not a bug.

**Fix.** Open **Recurring → Detected**, review each row, and click
**Confirm** on the ones that are real recurring bills. The forecast
picks them up immediately. If you *want* the guess-inclusive view for
a quick sanity check, toggle **"include detected series"**
directly on the Forecast page — a checkbox appears when only
detected series exist.

### A monthly bill is missing from Detected

**Symptom.** You pay the same subscription every month, but Athena
never surfaced it under **Recurring → Detected**.

**Cause.** The detector needs at least three occurrences with a
stable memo *and* a regular cadence. If the amount varies a lot (a
variable-price utility bill), or the memo changes between charges
(some card processors rotate a suffix), the detector skips it.

**Fix.** Add the series manually: **Recurring → Detected → + Add
une série**, pick the account, a memo pattern, an amount range, and
a cadence. Confirm it and it starts feeding Upcoming and Forecast on
the next tick.

### Upcoming shows the same bill twice this month

**Symptom.** **Recurring → Upcoming** lists two entries for the same
recurring series in the current month.

**Cause.** The month covers a "long" period between two occurrences
of a bi-weekly or 28-day cadence, so two payments genuinely fall in
the same calendar month — this is correct behaviour, not a duplicate.
Alternatively, a one-off ad-hoc payment on the same date as the
projected occurrence has been included in the upcoming list.

**Fix.** Check the dates. If both are legitimate cadence hits, leave
them. If one is an ad-hoc payment you don't want projected, edit the
series and pin its **next occurrence date** to the correct one — the
duplicate drops off.

## MCP access

### Tools don't appear in the client

**Symptom.** You wired the `athena` MCP server into your client's
config, restarted the client, and the six Athena tools
(`search_transactions`, `create_transaction`, …) still don't show up.

**Cause.** Either the `command`/`args` path in the client config
doesn't resolve to a built `mcp/` module, or the module is present
but wasn't built after an update (missing `dist/`), or the client
never re-read its config.

**Fix.** From the repo, run `cd mcp && npm install && npm run build`.
Verify the `command` in the client config points at the built entry
(usually an absolute path to `mcp/dist/index.js`). Fully quit and
relaunch the client — restart-in-place is not enough for most MCP
clients.

### Every tool call returns "unauthorized"

**Symptom.** Tools appear in the client, but any call fails with
`unauthorized` or `invalid token`.

**Cause.** The `ATHENA_MCP_TOKEN` in the client config is empty,
truncated on paste, or was rotated in Athena and not updated in the
client.

**Fix.** In Athena, open **Settings → MCP**, revoke and regenerate
the token, copy it whole (they're long — mind the terminal wrap),
paste into the client config, restart the client. Also check the
`ATHENA_MCP_USER` matches your login username exactly (case matters).

### `reconcile_statement` says the PDF path is not readable

**Symptom.** Every other MCP tool works, but `reconcile_statement`
fails with `path not readable` or `no such file`.

**Cause.** MCP tools run in the client's process, so relative paths
resolve against the *client's* working directory — usually not where
your statements live. Passing a bare filename fails unless
`ATHENA_STATEMENTS_DIR` is set.

**Fix.** Either pass an absolute path to the PDF, or set
`ATHENA_STATEMENTS_DIR` in the client's `env` block to the folder
your statements live in — then a bare filename resolves against that
folder. See [MCP access](./mcp) for the full config shape.

## Login and session

### "Session expired" prompts every time you reopen the app

**Symptom.** You log in, work for a minute, close the tab or the
window; on returning you're immediately kicked back to the login
screen.

**Cause.** Either the browser is refusing to store the session
cookie (private browsing, third-party-cookie block on a subdomain
setup), or `SESSION_SECRET` changed between the moment you logged in
and now (e.g. the stack was restarted with a freshly-generated
value), which invalidates every cookie already issued.

**Fix.** Use a regular (non-private) window. If you're behind a
reverse proxy, make sure it doesn't strip or rewrite the `Set-Cookie`
header. Confirm `SESSION_SECRET` in `.env` is stable across restarts
— never regenerate it after the initial setup unless you want to log
everyone out on purpose.

### Fresh install won't accept any credentials

**Symptom.** On a brand-new install, the login page rejects
everything you try, and there's no obvious sign-up link.

**Cause.** Athena is single-user per install and does not expose a
public sign-up. The first user must be seeded — either via the
desktop app's onboarding flow, or, on Docker, via the backend's
first-run command.

**Fix.** Desktop: reopen the app to the onboarding screen. Docker:
follow the setup instructions in
[Getting started](./getting-started) → *Create the first user*. If
you already ran through onboarding but forgot the password, the fix
is a database-level reset (there is no email-based reset flow, by
design — no email server, no external dependency).

## Desktop app updates

### macOS Gatekeeper blocks the first launch

**Symptom.** Double-clicking the downloaded `.dmg` or `.app` produces
a dialog like *"Athena Accounting cannot be opened because Apple
cannot check it for malicious software"*.

**Cause.** The build is signed but not notarised for every macOS
version, or Gatekeeper is being extra-cautious about a newly-issued
signing certificate.

**Fix.** Right-click the app icon → **Open** (not double-click) —
this shows an "Open anyway" dialog that only appears via the right-
click path. Alternatively: **System Settings → Privacy & Security**,
scroll to the "Athena Accounting was blocked…" message, click **Open
anyway**.

### App won't start after an update

**Symptom.** The app updated silently overnight; today it bounces in
the Dock (macOS) or the process starts and immediately exits
(Windows/Linux), with no visible window.

**Cause.** A previous instance is still holding the PGlite database
file, or the updater couldn't finish overwriting one of the app's
resources.

**Fix.** Force-quit every running instance (macOS: `⌘⌥⎋` → Athena
Accounting → Force Quit; Windows: Task Manager → End task on every
Athena process). Relaunch. If the crash repeats, follow
[`athena.db` is corrupted](#athenadb-is-corrupted-desktop-app) — the
file may have been left mid-write by the update.

### Auto-update sits at "Downloading…" forever

**Symptom.** The updater says it's downloading a new version, but the
progress bar never moves, or it retries repeatedly.

**Cause.** The GitHub Releases CDN is momentarily unreachable, or a
corporate proxy / VPN is intercepting the connection with a
certificate the updater doesn't trust.

**Fix.** Cancel the in-app update, download the latest installer
directly from
[GitHub Releases](https://github.com/Gekkotron/Athena-Accounting/releases),
and install over the current version — your local data is
preserved.

## Performance

### Dashboard takes several seconds to render

**Symptom.** Opening the dashboard on the "year to date" range
takes noticeably long — 3–10 seconds — after your transaction table
grew past ~50k rows.

**Cause.** The heaviest widgets (Sankey, per-category breakdown,
timeseries) each pull their own aggregate. On a wide range with a
large history, the aggregate queries dominate.

**Fix.** Narrow the default range to the current quarter — most
users never look further back day-to-day. If you regularly need the
full-year view, pin it to the Reports tab instead, and pre-warm the
cache by opening it once at the start of the day.

### Import feels slow on a big PDF

**Symptom.** Importing a 20+ MB statement PDF takes minutes; the
progress bar sits at "extracting text" for a long time.

**Cause.** OCR passes over every page of a scanned PDF (scanned
statements from older banks are the usual culprit), even if only a
handful of pages contain a transaction table.

**Fix.** Split the PDF to the relevant pages before importing —
`pdftk statement.pdf cat 3-8 output slice.pdf`, or use Preview.app
on macOS. If your bank consistently produces scanned PDFs, ask them
for text-based exports (usually available under a different menu
item).

### A transaction you know exists doesn't show up in search

**Symptom.** You search by memo, amount, or date, and a transaction
you can see in the account view doesn't appear in the results.

**Cause.** Search matches against the *normalised* memo (accents
stripped, punctuation collapsed), not the raw one you see in the
list — a search for `café` finds `Café` but not `CAFE-BAR` if the
normalisation kept the dash.

**Fix.** Search on a fragment rather than a full word (`caf` instead
of `café`), or search by amount (unique amounts are the fastest way
to find a specific row). See [Categorization](./categorization) for
how the normalisation pipeline works — the same rules apply to
search.

## Gathering diagnostics

Before opening an issue, collect these three things — they resolve
most tickets on the first exchange.

### Container logs (Docker install)

```sh
docker compose logs --tail=200 backend
docker compose logs --tail=200 db
```

The last 200 lines are usually enough. If the failure is on startup,
add `--since 5m` to get a full window. Redact any lines that contain
`SESSION_SECRET`, `DATABASE_URL` or a cookie value before pasting.

### Health endpoint

```sh
curl -s http://localhost:8001/health
```

Returns `{ "status": "ok", "db": "ok" }` when everything is wired up.
`{ "db": "down" }` narrows the problem to Postgres; a connection error
narrows it to the backend or its port binding. The default backend
port is `8001` — change it if you set `BACKEND_PORT` in `.env`.

### Metrics endpoint

```sh
curl -s http://localhost:8001/metrics
```

Exposes Prometheus-format counters and histograms. The two lines worth
grepping for when something feels slow are `http_request_duration_seconds`
(per-route latency) and `athena_imports_failed_total` (import failures
by reason). Attach a snippet of the output to your issue if you're
reporting a performance regression.

*See also:* [Importing](./importing) ·
[Getting started](./getting-started) ·
[Backup and recovery](./backup-recovery)

← [Back to user docs](README.md)
