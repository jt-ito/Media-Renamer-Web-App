#!/usr/bin/env bash
set -euo pipefail

# Dev helper: start web dev and server dev with env and combined logs
# Usage: bash scripts/dev.sh

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Defaults (can be overridden in env)
: "${PORT:=8787}"
: "${STATIC_ROOT:=$ROOT/web/dist}"

WEB_LOG="$ROOT/web-dev.log"
SERVER_LOG="$ROOT/server-dev.log"

rm -f "$WEB_LOG" "$SERVER_LOG"

echo "Starting web dev (logs -> $WEB_LOG)" >&2
(
  pnpm -C web run dev 2>&1 | sed 's/^/[WEB] /' >> "$WEB_LOG"
) &
WEB_PID=$!

echo "Starting server dev (logs -> $SERVER_LOG) with PORT=$PORT STATIC_ROOT=$STATIC_ROOT" >&2
(
  export PORT
  export STATIC_ROOT
  pnpm -C server run dev 2>&1 | sed 's/^/[SRV] /' >> "$SERVER_LOG"
) &
SRV_PID=$!

# Ensure children are killed when this script exits
trap 'echo "Stopping dev processes..."; kill "$WEB_PID" "$SRV_PID" 2>/dev/null || true; wait 2>/dev/null || true' EXIT

# Wait briefly for logs to be created
sleep 1

# Tail both logs in this terminal (Ctrl-C will stop tailing but keep processes running until script exit)
if command -v multitail >/dev/null 2>&1; then
  multitail -l "tail -n +1 -F $WEB_LOG" -l "tail -n +1 -F $SERVER_LOG"
else
  echo "Tailing logs (Ctrl+C to stop tail). Logs: $WEB_LOG, $SERVER_LOG" >&2
  tail -n +1 -F "$WEB_LOG" "$SERVER_LOG"
fi
