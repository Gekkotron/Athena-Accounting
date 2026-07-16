# Development

How to run Athena locally, how to run the tests, and how to submit a
change. This page assumes you have Docker and (optionally, for a nicer
dev loop) Node 20 installed.

## Local setup

Clone and generate secrets:

```bash
git clone https://github.com/Gekkotron/Athena-Accounting.git
cd Athena-Accounting
./install.sh
```

`install.sh` writes a `.env` file with strong random secrets. Edit it
if you want to change ports or DB credentials; the defaults are fine
for local dev.

Bring the stack up:

```bash
docker compose up --build
```

The first build is slow (Node install + Postgres extensions). Later
starts are fast. Open <http://127.0.0.1:8000>.

## Running the app in dev mode

`docker compose up` uses the production build of the frontend. For
active frontend work with HMR, you'll want to run the Vite dev server
directly:

```bash
cd frontend
npm install
npm run dev
```

The backend still runs in Docker; the Vite dev server proxies `/api`
to `http://127.0.0.1:8001` per `frontend/vite.config.ts`.

## Running the tests

Backend tests are split into two tiers.

### Unit and route tests (no database)

Most backend tests run without a database:

```bash
cd backend
npm install
npm test
```

The DB-gated tests are marked `describe.skipIf(!RUN_DB_TESTS)` and
will show as *skipped* in this run — that's expected.

### DB-gated integration tests

The route/integration tests need a real Postgres. They are gated
behind the `RUN_DB_TESTS=1` environment variable.

> **⚠️ You cannot point them at your real database.**
> These tests reset state with unconditional whole-table deletes
> (`db.delete(transactions)`, `db.delete(accounts)`, `db.delete(users)`, …)
> against whatever `DATABASE_URL` is set to. Pointing them at your real
> database would wipe it. They also assume a fresh, empty, migrated
> database (onboarding only succeeds when no user exists).

The safe way to run them is the wrapper script, which spins up a
throwaway `postgres:16-alpine` on tmpfs, applies migrations, runs the
suite with `RUN_DB_TESTS=1`, and tears everything down:

```bash
bash backend/scripts/test-db.sh
```

Pass args straight through:

```bash
bash backend/scripts/test-db.sh tests/transactions-route.test.ts   # one file
bash backend/scripts/test-db.sh -t "running balance"               # by test name
```

Set `KEEP_TEST_DB=1` to leave the stack up for debugging (the script
prints how to tear it down).

Without the wrapper, the same thing is:

```bash
docker compose -f docker-compose.test.yml run --rm --build backend-test
docker compose -f docker-compose.test.yml down -v
```

On a dev machine with npm, `cd backend && npm run test:db` calls the
same script.

### How it works

- `docker-compose.test.yml` defines two throwaway services: `test-db`
  (ephemeral Postgres) and `backend-test`.
- `backend-test` builds the `test` stage of `backend/Dockerfile`
  (build stage + test files). Its entrypoint
  (`backend/scripts/docker-test-entrypoint.sh`) applies migrations,
  then runs `vitest run`.
- Everything is isolated in its own compose project with test-only
  credentials, so it cannot collide with the real stack.

### Relation to CI

`.github/workflows/ci.yml` does the same thing (disposable Postgres →
migrate → `RUN_DB_TESTS=1` test run), so this is the local equivalent
of a CI database run.

## Type checking and linting

```bash
cd backend
npm run typecheck
```

```bash
cd frontend
npm run typecheck
npm run lint
```

Both must pass before you commit.

## Commit and PR conventions

- One logical change per commit. If your change touches multiple
  concerns, split them.
- Commit messages use `type(scope): summary` where `type` is `feat`,
  `fix`, `refactor`, `docs`, `test`, or `chore`.
- Pull requests should describe *why*, not just *what*. The diff
  covers the *what*.
- CI must be green before merge.

## Where to go next

- **[Architecture](architecture.md)** — how the pieces fit together.
- **[Code map](code-map.md)** — where things live.
- **[Database](database.md)** — schema and migrations.

← [Back to contributor docs](README.md)
