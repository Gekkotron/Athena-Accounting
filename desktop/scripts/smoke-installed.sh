#!/usr/bin/env bash
# Layer 2 installed-app smoke (macOS + Linux; Windows lives in
# smoke-installed.ps1): launch the packaged app the way a user would — the
# .app copied out of the mounted .dmg on macOS, the binary dpkg installs
# from the .deb on Linux — wait for the sidecar to publish its bound port at
# <app-data-dir>/.mcp-port, assert /health, then run the Playwright suite in
# frontend/e2e-installed/ against the live app.
#
# This is the layer the bundled-sidecar smoke (smoke-encryption.sh, Layer 1)
# can't cover: installer packaging, the Rust shell's spawn/port contract,
# and the WebView runtime deps of the final artifact.
#
# Usage:
#   [EXPECTED_VERSION=1.2.3] bash desktop/scripts/smoke-installed.sh <artifact>
#
# On Linux the <artifact> is a .deb; install needs sudo (dpkg -i, plus
# `apt-get install -f` for any missing runtime deps).
#
# Requirements: node on PATH, frontend deps installed (npm ci) and a
# Playwright chromium (npx playwright install chromium). The Tauri WebView
# needs a display — wrap with `xvfb-run -a` on headless Linux runners.
set -euo pipefail

ARTIFACT="${1:?usage: smoke-installed.sh <path to .dmg or .deb>}"
# Absolute path — the Linux branch runs it from a different cwd.
ARTIFACT="$(cd "$(dirname "$ARTIFACT")" && pwd)/$(basename "$ARTIFACT")"
IDENTIFIER="com.athena.accounting.desktop"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
APP_PID=""
DMG_MOUNT=""

cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    # SIGTERM first: the shell forwards shutdown to the sidecar (final
    # snapshot flush, lock release). Escalate only if it hangs.
    kill "$APP_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$APP_PID" 2>/dev/null || break
      sleep 0.5
    done
    kill -9 "$APP_PID" 2>/dev/null || true
  fi
  if [ -n "$DMG_MOUNT" ]; then
    hdiutil detach "$DMG_MOUNT" -quiet || true
    rmdir "$DMG_MOUNT" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

case "$(uname)" in
  Darwin)
    DATA_DIR="$HOME/Library/Application Support/$IDENTIFIER"
    # The mountpoint must have NO symlink among its ancestors: tauri's
    # resource resolution goes through tauri_utils::platform::current_exe(),
    # which on macOS refuses an exe path containing a symlinked ancestor (a
    # symlink-attack guard) — and $TMPDIR lives under /var, which IS a
    # symlink to /private/var. An app launched from a `mktemp -d` path
    # therefore fails resource_dir() with UnknownPath while the same bundle
    # works from /Applications. /private/tmp is symlink-free.
    DMG_MOUNT="$(mktemp -d /private/tmp/athena-smoke-dmg.XXXXXX)"
    hdiutil attach "$ARTIFACT" -nobrowse -readonly -mountpoint "$DMG_MOUNT" >/dev/null
    # Run straight from the mounted dmg (a normal way to launch a mac app —
    # the app only writes to DATA_DIR). Cleanup kills the app first, then
    # detaches.
    APP_DIR="$(echo "$DMG_MOUNT"/*.app)"
    APP_BIN="$(find "$APP_DIR/Contents/MacOS" -maxdepth 1 -type f | head -n 1)"
    ;;
  Linux)
    DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/$IDENTIFIER"
    # dpkg first; if it exits non-zero because of missing runtime deps
    # (common on a fresh runner before webkit/gtk libs are pulled in),
    # `apt-get install -f` resolves the dep graph and retries the install.
    if ! sudo dpkg -i "$ARTIFACT"; then
      sudo apt-get install -y -f
    fi
    # Package name = the Debian "Package" control field. Resolve the
    # installed binary via `dpkg -L` so the smoke script doesn't have to
    # hard-code the productName-derived name.
    PKG_NAME="$(dpkg-deb -f "$ARTIFACT" Package)"
    APP_BIN="$(dpkg -L "$PKG_NAME" | awk '/^\/usr\/bin\// {print; exit}')"
    if [ -z "$APP_BIN" ] || [ ! -x "$APP_BIN" ]; then
      echo "could not locate a /usr/bin/ entry for $PKG_NAME" >&2
      exit 1
    fi
    ;;
  *)
    echo "unsupported platform $(uname) — Windows uses smoke-installed.ps1" >&2
    exit 1
    ;;
esac

PORT_FILE="$DATA_DIR/.mcp-port"
rm -f "$PORT_FILE"

echo "launching: $APP_BIN"
"$APP_BIN" &
APP_PID=$!

# The sidecar writes .mcp-port right after Fastify binds (entry/tauri.ts).
PORT=""
for _ in $(seq 1 120); do
  if [ -s "$PORT_FILE" ]; then
    PORT="$(tr -d '[:space:]' < "$PORT_FILE")"
    break
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "app exited before publishing a port" >&2
    exit 1
  fi
  sleep 1
done
if [ -z "$PORT" ]; then
  echo "timed out waiting for $PORT_FILE" >&2
  exit 1
fi

BASE_URL="http://127.0.0.1:$PORT"
echo "sidecar bound on $BASE_URL"
HEALTH="$(curl -fsS --retry 10 --retry-delay 1 --retry-connrefused "$BASE_URL/health")"
echo "health: $HEALTH"
HEALTH_JSON="$HEALTH" node -e '
  const h = JSON.parse(process.env.HEALTH_JSON);
  if (h.ok !== true) throw new Error("health not ok");
  if (h.driver !== "pglite") throw new Error("unexpected driver " + h.driver);
  const want = process.env.EXPECTED_VERSION;
  if (want && h.version !== want) throw new Error(`version ${h.version} != expected ${want}`);
'

# Fast, unambiguous signal before the browser suite: the sidecar must serve
# the SPA at /, not just the API (a wrong static root shows up here as a
# one-line failure instead of three Playwright timeouts).
curl -fsS -o /dev/null "$BASE_URL/" || {
  echo "GET / failed — the app is up but does not serve the SPA (static root?)" >&2
  exit 1
}

(
  cd "$REPO_ROOT/frontend"
  ATHENA_SMOKE_URL="$BASE_URL" ATHENA_EXPECT_VERSION="${EXPECTED_VERSION:-}" \
    npx playwright test -c playwright.installed.config.ts
)

echo "installed-app smoke passed"
