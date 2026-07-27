#!/usr/bin/env bash
#
# End-to-end smoke test for desktop encryption-at-rest, exercised against the
# real sidecar entry point (backend/src/entry/tauri.ts) — no mocks. Boots the
# sidecar stand-in the same way the Tauri shell does, drives it through the
# HTTP contract (enable / clean shutdown / locked boot / unlock / crash
# recovery / disable), and asserts on-disk state at each hand-off.
#
# Usage (from anywhere in the repo):
#   bash desktop/scripts/smoke-encryption.sh
#
# Requires: node (with backend/node_modules installed, for --import tsx) and
# curl. No Docker/Postgres — this drives the pglite/DATA_DIR desktop path.
#
# Bundle mode: set SIDECAR_DIR=/path/to/desktop/sidecar to smoke the BUILT
# sidecar (bundled node binary + esbuild entry.js + production node_modules)
# instead of the tsx dev entry — this is what the desktop-release workflow
# runs, and it needs nothing from backend/node_modules:
#   SIDECAR_DIR="$PWD/desktop/sidecar" bash desktop/scripts/smoke-encryption.sh
#
# IMPORTANT process-lifetime note: src/entry/tauri.ts starts a parent
# watchdog that SIGKILLs the sidecar ~2s after its parent process exits (see
# parentWatchdog.ts) — this guards against orphaned sidecars wedging PGlite
# on a force-quit shell. That means every sidecar launched below MUST be a
# direct child of *this* script process for its entire life. Do not run the
# sidecar via `sh -c '... &'`, `bash -c`, or any wrapper that itself returns
# after backgrounding — that wrapper becomes the sidecar's parent and then
# promptly exits, and the sidecar dies within ~2s. Launching with `( ... ) &`
# from this script and using `exec` inside the subshell keeps this script as
# the real parent for as long as the sidecar runs.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/athena-smoke-XXXXXX")"
DATA_DIR="$WORK_DIR/data"
mkdir -p "$DATA_DIR"

PASSWORD="smoke-pass-123"

# PIDs of every sidecar this script has ever launched — the cleanup trap
# kills whatever is still alive, whether the script exits cleanly, fails a
# stage, or is interrupted.
SIDECAR_PIDS=()
# The currently-running sidecar's pid/log/port, refreshed by start_sidecar /
# wait_for_port.
CUR_PID=""
CUR_LOG=""
CUR_PORT=""

FAILED=0
STAGE_NAME=""

log() { printf '[smoke] %s\n' "$*"; }

pass_stage() {
  printf 'PASS: %s\n' "$1"
}

fail_stage() {
  printf 'FAIL: %s\n' "$1"
  FAILED=1
}

# Aborts the whole run on the first failing stage, per the brief: exit
# non-zero immediately rather than limping through later stages against
# already-broken state.
require() {
  # require <ok:0|1> <stage label>
  if [ "$1" -ne 0 ]; then
    fail_stage "$2"
    cleanup
    exit 1
  fi
  pass_stage "$2"
}

cleanup() {
  for pid in "${SIDECAR_PIDS[@]:-}"; do
    [ -z "$pid" ] && continue
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null
    fi
  done
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

# --- small JSON helper --------------------------------------------------
# No jq dependency: node is already a hard requirement to run the sidecar
# itself, so use it to pull one top-level field out of a JSON blob on stdin.
# Prints the raw JSON-encoded value (e.g. `true`, `"checking"`) or nothing
# if the field is absent / the input isn't valid JSON.
json_field() {
  node -e '
    let d = "";
    process.stdin.on("data", (c) => { d += c; });
    process.stdin.on("end", () => {
      try {
        const o = JSON.parse(d);
        const v = o[process.argv[1]];
        process.stdout.write(v === undefined ? "" : JSON.stringify(v));
      } catch {
        process.stdout.write("");
      }
    });
  ' "$1"
}

# Counts entries in a top-level array field (e.g. "accounts") and prints
# the JSON-stringified list of a sub-field from each entry, one per line —
# used to assert "account X is present" without needing full JSON parsing
# in bash.
json_array_field() {
  # json_array_field <arrayKey> <itemKey>
  node -e '
    let d = "";
    process.stdin.on("data", (c) => { d += c; });
    process.stdin.on("end", () => {
      try {
        const o = JSON.parse(d);
        const arr = o[process.argv[1]];
        if (!Array.isArray(arr)) return;
        for (const item of arr) process.stdout.write(String(item[process.argv[2]]) + "\n");
      } catch { /* print nothing */ }
    });
  ' "$1" "$2"
}

# --- HTTP helpers --------------------------------------------------------
# Every call returns "<status>\n<body>" via a marker line so callers can pull
# both out without a second round trip.

http_get() {
  # http_get <url>
  local resp
  resp=$(curl -s -w '\n%{http_code}' "$1")
  printf '%s' "$resp" | tail -n1
  printf '\n'
  printf '%s' "$resp" | sed '$d'
}

http_post() {
  # http_post <url> <json-body>
  local resp
  resp=$(curl -s -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' -d "$2" "$1")
  printf '%s' "$resp" | tail -n1
  printf '\n'
  printf '%s' "$resp" | sed '$d'
}

http_status() { printf '%s' "$1" | head -n1; }
http_body() { printf '%s' "$1" | tail -n +2; }

# --- sidecar process management ------------------------------------------

# Launches the sidecar stand-in as a direct child of this script (see the
# lifetime note at the top of the file). Appends the new pid to
# SIDECAR_PIDS and sets CUR_PID/CUR_LOG.
start_sidecar() {
  local logfile
  logfile="$(mktemp "$WORK_DIR/sidecar-log.XXXXXX")"
  (
    if [ -n "${SIDECAR_DIR:-}" ]; then
      # Bundle mode: run the exact artifact the Tauri shell ships.
      cd "$SIDECAR_DIR" || exit 1
      node_bin="./node"
      [ -x "./node.exe" ] && node_bin="./node.exe"
      exec env DATA_DIR="$DATA_DIR" "$node_bin" entry.js
    else
      cd "$BACKEND_DIR" || exit 1
      exec env DATA_DIR="$DATA_DIR" node --import tsx src/entry/tauri.ts
    fi
  ) >"$logfile" 2>&1 &
  CUR_PID=$!
  CUR_LOG="$logfile"
  SIDECAR_PIDS+=("$CUR_PID")
}

# Polls the sidecar's stdout log for the ATHENA_PORT=<n> contract line (see
# tauri.ts). Fails fast on ATHENA_FATAL instead of waiting out the full
# timeout. Sets CUR_PORT on success.
wait_for_port() {
  local timeout="${1:-30}"
  local max_iters=$((timeout * 4))
  local i
  for ((i = 0; i < max_iters; i++)); do
    if grep -q '^ATHENA_FATAL=' "$CUR_LOG" 2>/dev/null; then
      log "sidecar reported ATHENA_FATAL: $(grep -m1 '^ATHENA_FATAL=' "$CUR_LOG")"
      return 1
    fi
    if grep -q '^ATHENA_PORT=' "$CUR_LOG" 2>/dev/null; then
      CUR_PORT=$(grep -m1 '^ATHENA_PORT=' "$CUR_LOG" | cut -d= -f2 | tr -d '\r')
      return 0
    fi
    if ! kill -0 "$CUR_PID" 2>/dev/null; then
      log "sidecar exited before printing ATHENA_PORT"
      return 1
    fi
    sleep 0.25
  done
  log "timed out waiting for ATHENA_PORT (log so far: $(cat "$CUR_LOG"))"
  return 1
}

# Sends SIGTERM and waits (up to $2s, default 20s — the shutdown handler
# flushes a final snapshot and finalizes migrations, which can take a few
# seconds) for the process to actually exit.
stop_sidecar_clean() {
  local pid="$1" timeout="${2:-20}"
  kill -TERM "$pid" 2>/dev/null
  local max_iters=$((timeout * 4))
  local i
  for ((i = 0; i < max_iters; i++)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

# Hard-kills (simulates a crash — no clean shutdown, no final snapshot flush).
kill_sidecar_hard() {
  local pid="$1"
  kill -9 "$pid" 2>/dev/null
  local i
  for ((i = 0; i < 40; i++)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

# Generic condition-poll: retries `"$@"` (a command) until it exits 0 or the
# deadline passes. Every wait in this script is condition-based except the
# one debounce wait the brief explicitly allows in stage 5.
poll_until() {
  local timeout="$1" interval="$2"
  shift 2
  local max_iters
  max_iters=$(node -e "console.log(Math.ceil(process.argv[1] / process.argv[2]))" "$timeout" "$interval")
  local i
  for ((i = 0; i < max_iters; i++)); do
    if "$@"; then
      return 0
    fi
    sleep "$interval"
  done
  return 1
}

health_says_unlocked() {
  # Polled during the hand-off between the unlock mini-server closing its
  # listener and the real app rebinding the same port — curl can genuinely
  # fail to connect for a beat in that window (status "000", empty body).
  # An empty `locked` field must NOT read as "unlocked": that's exactly the
  # false-positive that let this poll return success on a bare connection
  # refusal instead of retrying. Require an actual 200 with locked:false.
  local resp status body locked
  resp=$(http_get "http://127.0.0.1:$CUR_PORT/health")
  status=$(http_status "$resp")
  [ "$status" = "200" ] || return 1
  body=$(http_body "$resp")
  locked=$(printf '%s' "$body" | json_field locked)
  [ "$locked" = "false" ]
}

# --- stage helpers ---------------------------------------------------

create_account() {
  # create_account <port> <name>
  local port="$1" name="$2"
  local resp status body
  resp=$(http_post "http://127.0.0.1:$port/api/accounts" \
    "$(node -e 'console.log(JSON.stringify({name: process.argv[1], type: "checking", openingBalance: "0.00", openingDate: "2026-01-01"}))' "$name")")
  status=$(http_status "$resp")
  body=$(http_body "$resp")
  if [ "$status" != "200" ] && [ "$status" != "201" ]; then
    log "create_account($name) failed: HTTP $status — $body"
    return 1
  fi
  return 0
}

list_account_names() {
  # list_account_names <port>
  local port="$1"
  http_body "$(http_get "http://127.0.0.1:$port/api/accounts")" | json_array_field accounts name
}

assert_account_present() {
  # assert_account_present <port> <name>
  list_account_names "$1" | grep -qx "$2"
}

echo "=== Athena desktop encryption-at-rest smoke test ==="
log "work dir: $WORK_DIR"
log "data dir: $DATA_DIR"

# ------------------------------------------------------------------------
# Stage 1: fresh boot, seed an account, enable encryption.
# ------------------------------------------------------------------------
STAGE_NAME="1. fresh boot + seed + enable encryption"
start_sidecar
if ! wait_for_port 30; then
  require 1 "$STAGE_NAME"
fi
PORT1="$CUR_PORT"
log "stage 1: sidecar up on port $PORT1 (pid $CUR_PID)"

ok=1
create_account "$PORT1" "Compte Courant" || ok=0
if [ "$ok" -eq 1 ]; then
  resp=$(http_post "http://127.0.0.1:$PORT1/api/security/enable" "{\"password\":\"$PASSWORD\"}")
  status=$(http_status "$resp")
  if [ "$status" != "200" ]; then
    log "enable failed: HTTP $status — $(http_body "$resp")"
    ok=0
  fi
fi
if [ "$ok" -eq 1 ]; then
  [ -f "$DATA_DIR/athena.db.enc" ] || { log "athena.db.enc missing after enable"; ok=0; }
fi
if [ "$ok" -eq 1 ]; then
  marker_mode=$(json_field mode <"$DATA_DIR/security.json" 2>/dev/null)
  if [ "$marker_mode" != '"encrypted"' ]; then
    log "security.json mode is '$marker_mode', expected \"encrypted\""
    ok=0
  fi
fi
require "$((1 - ok))" "$STAGE_NAME"

# ------------------------------------------------------------------------
# Stage 2: clean shutdown removes the plaintext datadir.
# ------------------------------------------------------------------------
STAGE_NAME="2. clean shutdown removes plaintext datadir"
ok=1
if ! stop_sidecar_clean "$CUR_PID" 20; then
  log "sidecar did not exit within 20s of SIGTERM"
  ok=0
fi
if [ "$ok" -eq 1 ] && [ -d "$DATA_DIR/athena.db" ]; then
  log "athena.db/ plaintext directory still present after clean shutdown"
  ok=0
fi
require "$((1 - ok))" "$STAGE_NAME"

# ------------------------------------------------------------------------
# Stage 3: locked boot -> wrong password -> right password -> data present.
# ------------------------------------------------------------------------
STAGE_NAME="3. locked boot, unlock, seeded account present"
start_sidecar
ok=1
if ! wait_for_port 30; then
  ok=0
fi
PORT3="$CUR_PORT"
if [ "$ok" -eq 1 ]; then
  body=$(http_body "$(http_get "http://127.0.0.1:$PORT3/health")")
  locked=$(printf '%s' "$body" | json_field locked)
  if [ "$locked" != "true" ]; then
    log "expected /health locked:true on encrypted boot, got: $body"
    ok=0
  fi
fi
if [ "$ok" -eq 1 ]; then
  resp=$(http_post "http://127.0.0.1:$PORT3/api/unlock" '{"password":"definitely-wrong"}')
  status=$(http_status "$resp")
  if [ "$status" != "403" ]; then
    log "expected 403 for wrong password, got HTTP $status — $(http_body "$resp")"
    ok=0
  fi
fi
if [ "$ok" -eq 1 ]; then
  resp=$(http_post "http://127.0.0.1:$PORT3/api/unlock" "{\"password\":\"$PASSWORD\"}")
  status=$(http_status "$resp")
  unlock_ok=$(http_body "$resp" | json_field ok)
  if [ "$status" != "200" ] || [ "$unlock_ok" != "true" ]; then
    log "expected 200 {ok:true} for right password, got HTTP $status — $(http_body "$resp")"
    ok=0
  fi
fi
if [ "$ok" -eq 1 ] && ! poll_until 20 0.5 health_says_unlocked; then
  log "real server never rebound port $PORT3 with locked:false"
  ok=0
fi
if [ "$ok" -eq 1 ] && ! assert_account_present "$PORT3" "Compte Courant"; then
  log "seeded account 'Compte Courant' missing after unlock: $(list_account_names "$PORT3")"
  ok=0
fi
require "$((1 - ok))" "$STAGE_NAME"

# ------------------------------------------------------------------------
# Stage 4: mutate, clean shutdown, reboot+unlock, both accounts present.
# ------------------------------------------------------------------------
STAGE_NAME="4. clean-shutdown snapshot flush persists a new account"
ok=1
create_account "$PORT3" "Livret A" || ok=0
if [ "$ok" -eq 1 ] && ! stop_sidecar_clean "$CUR_PID" 20; then
  log "sidecar did not exit within 20s of SIGTERM"
  ok=0
fi
if [ "$ok" -eq 1 ]; then
  start_sidecar
  if ! wait_for_port 30; then
    ok=0
  fi
fi
PORT4="$CUR_PORT"
if [ "$ok" -eq 1 ]; then
  resp=$(http_post "http://127.0.0.1:$PORT4/api/unlock" "{\"password\":\"$PASSWORD\"}")
  status=$(http_status "$resp")
  if [ "$status" != "200" ]; then
    log "unlock after stage-4 reboot failed: HTTP $status — $(http_body "$resp")"
    ok=0
  fi
fi
if [ "$ok" -eq 1 ] && ! poll_until 20 0.5 health_says_unlocked; then
  log "real server never rebound port $PORT4 with locked:false (stage 4)"
  ok=0
fi
if [ "$ok" -eq 1 ]; then
  names=$(list_account_names "$PORT4")
  echo "$names" | grep -qx "Compte Courant" || { log "'Compte Courant' missing: $names"; ok=0; }
  echo "$names" | grep -qx "Livret A" || { log "'Livret A' missing: $names"; ok=0; }
fi
require "$((1 - ok))" "$STAGE_NAME"

# ------------------------------------------------------------------------
# Stage 5: crash recovery — SIGKILL after the debounced snapshot has landed.
# ------------------------------------------------------------------------
STAGE_NAME="5. crash recovery recovers the last debounced snapshot"
ok=1
create_account "$PORT4" "PEL" || ok=0
if [ "$ok" -eq 1 ]; then
  # snapshotScheduler's debounce is 10s (see snapshotScheduler.ts DEBOUNCE_MS)
  # — this is the one sleep the brief explicitly allows, since "the
  # debounced snapshot has landed" has no externally observable condition
  # short of reading the encrypted blob itself.
  log "waiting 12s for the debounced snapshot to flush before crashing…"
  sleep 12
fi
if [ "$ok" -eq 1 ] && ! kill_sidecar_hard "$CUR_PID"; then
  log "sidecar did not die within 10s of SIGKILL"
  ok=0
fi
if [ "$ok" -eq 1 ]; then
  start_sidecar
  if ! wait_for_port 30; then
    ok=0
  fi
fi
PORT5="$CUR_PORT"
if [ "$ok" -eq 1 ]; then
  resp=$(http_post "http://127.0.0.1:$PORT5/api/unlock" "{\"password\":\"$PASSWORD\"}")
  status=$(http_status "$resp")
  if [ "$status" != "200" ]; then
    log "unlock after crash-recovery reboot failed: HTTP $status — $(http_body "$resp")"
    ok=0
  fi
fi
if [ "$ok" -eq 1 ] && ! poll_until 20 0.5 health_says_unlocked; then
  log "real server never rebound port $PORT5 with locked:false (stage 5)"
  ok=0
fi
if [ "$ok" -eq 1 ]; then
  names=$(list_account_names "$PORT5")
  for want in "Compte Courant" "Livret A" "PEL"; do
    echo "$names" | grep -qx "$want" || { log "'$want' missing after crash recovery: $names"; ok=0; }
  done
fi
require "$((1 - ok))" "$STAGE_NAME"

# ------------------------------------------------------------------------
# Stage 6: disable encryption, clean shutdown, plain reboot, plaintext data.
# ------------------------------------------------------------------------
STAGE_NAME="6. disable encryption restores a plaintext boot"
ok=1
resp=$(http_post "http://127.0.0.1:$PORT5/api/security/disable" "{\"password\":\"$PASSWORD\"}")
status=$(http_status "$resp")
if [ "$status" != "200" ]; then
  log "disable failed: HTTP $status — $(http_body "$resp")"
  ok=0
fi
if [ "$ok" -eq 1 ] && ! stop_sidecar_clean "$CUR_PID" 20; then
  log "sidecar did not exit within 20s of SIGTERM (post-disable)"
  ok=0
fi
# disable-pending finalizes on the *next* boot, which is itself a locked
# boot (the encrypted snapshot is still on disk — see tauri.ts's
# disable-pending branch): /health still reports locked, one more unlock
# with the (still-valid, about-to-be-retired) password finalizes it.
if [ "$ok" -eq 1 ]; then
  start_sidecar
  if ! wait_for_port 30; then
    ok=0
  fi
fi
PORT6="$CUR_PORT"
if [ "$ok" -eq 1 ]; then
  body=$(http_body "$(http_get "http://127.0.0.1:$PORT6/health")")
  locked=$(printf '%s' "$body" | json_field locked)
  if [ "$locked" != "true" ]; then
    log "expected locked:true on disable-pending boot, got: $body"
    ok=0
  fi
fi
if [ "$ok" -eq 1 ]; then
  resp=$(http_post "http://127.0.0.1:$PORT6/api/unlock" "{\"password\":\"$PASSWORD\"}")
  status=$(http_status "$resp")
  if [ "$status" != "200" ]; then
    log "disable-finalizing unlock failed: HTTP $status — $(http_body "$resp")"
    ok=0
  fi
fi
if [ "$ok" -eq 1 ] && ! poll_until 20 0.5 health_says_unlocked; then
  log "real server never rebound port $PORT6 with locked:false (disable finalize)"
  ok=0
fi
if [ "$ok" -eq 1 ]; then
  names=$(list_account_names "$PORT6")
  for want in "Compte Courant" "Livret A" "PEL"; do
    echo "$names" | grep -qx "$want" || { log "'$want' missing after disable: $names"; ok=0; }
  done
fi
if [ "$ok" -eq 1 ] && ! stop_sidecar_clean "$CUR_PID" 20; then
  log "sidecar did not exit within 20s of SIGTERM (finalize boot)"
  ok=0
fi
if [ "$ok" -eq 1 ] && [ -f "$DATA_DIR/athena.db.enc" ]; then
  log "athena.db.enc still present after disable"
  ok=0
fi
if [ "$ok" -eq 1 ] && [ -f "$DATA_DIR/security.json" ]; then
  log "security.json still present after disable"
  ok=0
fi
if [ "$ok" -eq 1 ] && [ ! -d "$DATA_DIR/athena.db" ]; then
  log "plaintext athena.db/ directory missing after disable"
  ok=0
fi
# Final boot: a plain, unencrypted boot — no unlock phase at all.
if [ "$ok" -eq 1 ]; then
  start_sidecar
  if ! wait_for_port 30; then
    ok=0
  fi
fi
PORT6B="$CUR_PORT"
if [ "$ok" -eq 1 ]; then
  body=$(http_body "$(http_get "http://127.0.0.1:$PORT6B/health")")
  locked=$(printf '%s' "$body" | json_field locked)
  if [ "$locked" = "true" ]; then
    log "expected an unencrypted plain boot, but /health reports locked:true"
    ok=0
  fi
fi
if [ "$ok" -eq 1 ]; then
  names=$(list_account_names "$PORT6B")
  for want in "Compte Courant" "Livret A" "PEL"; do
    echo "$names" | grep -qx "$want" || { log "'$want' missing on final plain boot: $names"; ok=0; }
  done
fi
if [ "$ok" -eq 1 ] && ! stop_sidecar_clean "$CUR_PID" 20; then
  log "sidecar did not exit within 20s of SIGTERM (final plain boot)"
  ok=0
fi
require "$((1 - ok))" "$STAGE_NAME"

echo "=== all stages PASSED ==="
cleanup
trap - EXIT
exit 0
