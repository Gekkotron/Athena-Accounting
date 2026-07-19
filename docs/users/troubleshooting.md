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
