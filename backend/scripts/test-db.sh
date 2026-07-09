#!/usr/bin/env bash
#
# Run the DB-gated backend test suite against a throwaway, migrated Postgres —
# entirely inside Docker. Needs ONLY docker (+ compose plugin) and bash; no
# Node/npm on the host (the Geekom has no Node installed).
#
# Safe by construction: everything runs in the isolated, ephemeral stack from
# docker-compose.test.yml (tmpfs storage, test-only DB) — NEVER the production
# `db`. It builds the test image, applies migrations, runs the RUN_DB_TESTS=1
# suite, and tears the whole stack down again (even if tests fail).
#
# Usage (from anywhere in the repo):
#   bash backend/scripts/test-db.sh                                  # whole suite
#   bash backend/scripts/test-db.sh tests/transactions-route.test.ts # one file
#   bash backend/scripts/test-db.sh -t "running balance"             # by name
#
# Options (env vars):
#   KEEP_TEST_DB=1   leave the stack up after the run (for debugging)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.test.yml"
PROJECT="athena-test"

compose() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"; }

cleanup() {
  if [ "${KEEP_TEST_DB:-}" = "1" ]; then
    echo "==> KEEP_TEST_DB=1: leaving the test stack up."
    echo "    Tear it down with: docker compose -p $PROJECT -f $COMPOSE_FILE down -v"
    return
  fi
  echo "==> Tearing down throwaway test stack"
  compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Building + running DB-gated tests in Docker (throwaway Postgres)"
# `run` starts the healthy-gated test-db dependency first, then runs the suite.
compose run --rm --build backend-test "$@"
