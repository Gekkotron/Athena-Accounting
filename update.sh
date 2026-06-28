#!/bin/bash
set -e

cd "$(dirname "$0")"

BEFORE=$(git rev-parse HEAD)
git pull --rebase
AFTER=$(git rev-parse HEAD)

# Are both application containers already running? (db is an unchanged
# Postgres image and is not rebuilt here.)
BACKEND_RUNNING=$(docker compose ps -q backend 2>/dev/null)
FRONTEND_RUNNING=$(docker compose ps -q frontend 2>/dev/null)

if [ "$BEFORE" = "$AFTER" ] && [ -n "$BACKEND_RUNNING" ] && [ -n "$FRONTEND_RUNNING" ]; then
    echo "$(date): No changes and services already running, skipping rebuild."
    exit 0
fi

if [ "$BEFORE" = "$AFTER" ]; then
    echo "$(date): No code changes, but one or more services are not running — starting them."
else
    echo "$(date): Changes detected ($BEFORE -> $AFTER), rebuilding..."
fi

docker compose build --no-cache backend frontend
docker compose up -d --build

# Prune dangling images left over from --no-cache rebuilds.
docker image prune -f >/dev/null 2>&1 || true
echo "$(date): Dangling images pruned."

echo "$(date): Update complete."
