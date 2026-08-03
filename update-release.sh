#!/bin/bash
# Update a release-image deployment (docker-compose.release.yml) to the
# newest published version on GitHub — the prebuilt-image counterpart of
# update.sh (which rebuilds from source).
#
# What it does, in order:
#   1. git pull            — compose files and scripts are host-side.
#   2. Resolve the newest release tag from the GitHub API (the latest
#      STABLE release when one exists, otherwise the newest prerelease —
#      relevant while only RCs are published).
#   3. Exit early if .env already pins that version and the stack is up.
#   4. pg_dump a safety backup into ./backups/ (skipped only with
#      --no-backup, or when the db container is not running).
#   5. Pin ATHENA_VERSION in .env, pull the images, `up -d`.
#   6. Poll /health until the backend answers.
#
# Usage: ./update-release.sh [--no-backup]
set -euo pipefail

cd "$(dirname "$0")"

REPO="Gekkotron/Athena-Accounting"
COMPOSE=(docker compose -f docker-compose.release.yml)
NO_BACKUP=0
[ "${1:-}" = "--no-backup" ] && NO_BACKUP=1

git pull --rebase --autostash

# --- Resolve target version ---------------------------------------------------
# /releases/latest only knows about stable releases (404 while everything is
# a prerelease); fall back to the newest entry of the full list.
resolve_version() {
  local tag
  tag=$(curl -fsS "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1) || true
  if [ -z "$tag" ]; then
    tag=$(curl -fsS "https://api.github.com/repos/$REPO/releases?per_page=1" \
      | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)
  fi
  [ -n "$tag" ] || { echo "could not resolve a release tag from the GitHub API" >&2; return 1; }
  echo "${tag#v}"
}

VERSION="$(resolve_version)"
CURRENT="$(sed -n 's/^ATHENA_VERSION=//p' .env 2>/dev/null | tail -n 1)"
echo "$(date): newest published version: $VERSION (currently pinned: ${CURRENT:-none})"

BACKEND_RUNNING=$("${COMPOSE[@]}" ps -q backend 2>/dev/null || true)
if [ "$VERSION" = "$CURRENT" ] && [ -n "$BACKEND_RUNNING" ]; then
  echo "$(date): already on $VERSION and running — nothing to do."
  exit 0
fi

# --- Safety backup --------------------------------------------------------------
DB_RUNNING=$("${COMPOSE[@]}" ps -q db 2>/dev/null || true)
if [ "$NO_BACKUP" = 1 ]; then
  echo "$(date): backup skipped (--no-backup)."
elif [ -z "$DB_RUNNING" ]; then
  echo "$(date): db container not running — skipping backup (nothing to dump)."
else
  mkdir -p backups
  BACKUP="backups/athena-$(date +%F-%H%M)-pre-${VERSION}.sql"
  # Single quotes on purpose: POSTGRES_* are set inside the container, not
  # in this shell.
  "${COMPOSE[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$BACKUP"
  [ -s "$BACKUP" ] || { echo "backup at $BACKUP is empty — aborting" >&2; exit 1; }
  echo "$(date): backup written to $BACKUP ($(du -h "$BACKUP" | cut -f1))."
fi

# --- Pin, pull, restart ---------------------------------------------------------
if grep -q '^ATHENA_VERSION=' .env 2>/dev/null; then
  sed -i.bak "s/^ATHENA_VERSION=.*/ATHENA_VERSION=$VERSION/" .env && rm -f .env.bak
else
  printf '\nATHENA_VERSION=%s\n' "$VERSION" >> .env
fi

"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d

# --- Health check ---------------------------------------------------------------
BACKEND_PORT="$(sed -n 's/^BACKEND_PORT=//p' .env 2>/dev/null | tail -n 1)"
BACKEND_PORT="${BACKEND_PORT:-8001}"
for _ in $(seq 1 30); do
  if HEALTH=$(curl -fsS "http://127.0.0.1:$BACKEND_PORT/health" 2>/dev/null); then
    echo "$(date): backend healthy: $HEALTH"
    docker image prune -f >/dev/null 2>&1 || true
    echo "$(date): update to $VERSION complete."
    exit 0
  fi
  sleep 2
done
echo "$(date): backend did not answer /health on port $BACKEND_PORT within 60s" >&2
echo "  inspect with: ${COMPOSE[*]} logs backend" >&2
exit 1
