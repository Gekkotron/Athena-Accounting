# Running the DB-gated tests

Most backend tests run without a database. A subset — the route/integration
tests — need a real Postgres and are gated behind the `RUN_DB_TESTS=1`
environment variable (they `describe.skipIf(!RUN)` otherwise, which is why a
plain test run reports them as *skipped*).

## ⚠️ Why you can't just point them at your database

These tests reset state with **unconditional, whole-table deletes**
(`db.delete(transactions)`, `db.delete(accounts)`, `db.delete(users)`, …).
They run against whatever `DATABASE_URL` is set to. **Pointing them at your
real database would wipe it.** They also assume a *fresh, empty, migrated*
database each run (onboarding only succeeds when no user exists).

So they must run against a throwaway database — never the production one.

## Running it (Docker only — no Node/npm needed on the host)

The whole thing runs inside Docker, which is the only dependency (the Geekom
has no Node installed). From the repo root:

```bash
bash backend/scripts/test-db.sh
```

That one command builds the test image, starts an **isolated, ephemeral**
`postgres:16-alpine` (tmpfs storage — nothing persists, so it can never touch
the real `./postgres-data` volume), applies migrations, runs the suite with
`RUN_DB_TESTS=1`, and tears everything down again — even if tests fail.

Pass args straight through:

```bash
bash backend/scripts/test-db.sh tests/transactions-route.test.ts   # one file
bash backend/scripts/test-db.sh -t "running balance"               # by test name
```

Set `KEEP_TEST_DB=1` to leave the stack up for debugging (the script prints how
to tear it down).

### Without the wrapper script

The script is just a thin wrapper around two compose commands, if you prefer to
run them yourself:

```bash
docker compose -f docker-compose.test.yml run --rm --build backend-test
docker compose -f docker-compose.test.yml down -v
```

### On a dev machine that has npm

`npm run test:db` (from `backend/`) calls the same script.

## How it works

- `docker-compose.test.yml` defines two throwaway services: `test-db`
  (ephemeral Postgres) and `backend-test`.
- `backend-test` builds the `test` stage of `backend/Dockerfile`, which reuses
  the build stage (full dev dependencies + source) and adds the test files. Its
  entrypoint (`backend/scripts/docker-test-entrypoint.sh`) applies migrations,
  then runs `vitest run`.
- Everything is isolated in its own compose project with a test-only database
  and credentials, so it cannot collide with or corrupt the real stack.

## Relation to CI

This mirrors what `.github/workflows/ci.yml` does (disposable Postgres →
migrate → `RUN_DB_TESTS=1` test run), so it's the local/Geekom equivalent of a
CI database run.
