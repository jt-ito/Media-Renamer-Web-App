#!/usr/bin/env bash
set -euo pipefail

# run-local.sh — start server and web without building (uses pnpm dev scripts)
# Location: repository root

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"

echo "Starting media-renamer in dev mode (no build)"

# Set safe defaults so the server can persist settings when run locally
export SETTINGS_PATH="$REPO_ROOT/config/settings.json"
export PORT=${PORT:-8787}
# If a built web/dist exists in repo, point STATIC_ROOT at it so the server can serve the SPA
if [ -d "$REPO_ROOT/web/dist" ]; then
  export STATIC_ROOT="$REPO_ROOT/web/dist"
fi

# Ensure Node present
if ! command -v node >/dev/null 2>&1; then
  echo "node not found. Install Node.js (>=18) and try again." >&2
  exit 1
fi

# Enable corepack and ensure pnpm is available
if command -v corepack >/dev/null 2>&1; then
  corepack enable || true
  corepack prepare pnpm@latest --activate || true
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v npm >/dev/null 2>&1; then
    echo "pnpm not found — installing via npm (requires permissions)"
    npm install -g pnpm || true
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not available. Install pnpm or enable corepack and retry." >&2
  exit 1
fi

echo "Installing dependencies (server + web). This may take a few minutes..."
pnpm -C server install
pnpm -C web install

# Create logs dir
mkdir -p "$REPO_ROOT/logs"

echo "Starting server -> logs/server.log"
pnpm -C server run dev > "$REPO_ROOT/logs/server.log" 2>&1 &
server_pid=$!
echo $server_pid > "$REPO_ROOT/logs/server.pid"

echo "Starting web -> logs/web.log"
pnpm -C web run dev > "$REPO_ROOT/logs/web.log" 2>&1 &
web_pid=$!
echo $web_pid > "$REPO_ROOT/logs/web.pid"

# Ensure children are killed on exit
cleanup() {
  echo "Stopping server (pid=$server_pid) and web (pid=$web_pid) ..."
  kill "$server_pid" 2>/dev/null || true
  kill "$web_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "Tailing logs (press Ctrl-C to stop)."
tail -n +1 -F "$REPO_ROOT/logs/server.log" "$REPO_ROOT/logs/web.log" &
tail_pid=$!

# Wait for the tail process (keeps script in foreground)
wait "$tail_pid"

exit 0
