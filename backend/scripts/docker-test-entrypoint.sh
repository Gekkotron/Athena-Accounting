#!/bin/sh
# Entrypoint for the Dockerfile `test` stage: apply migrations against the
# throwaway DB, then run the DB-gated suite. Any args are forwarded to vitest
# (e.g. a specific file or `-t "name"`).
set -e

echo "==> Applying migrations"
npx tsx -e 'import("./src/db/migrate.js").then((m) => m.runMigrations()).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); })'

echo "==> Running DB-gated test suite (RUN_DB_TESTS=1)"
exec npx vitest run "$@"
