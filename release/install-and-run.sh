echo "Starting server"
#!/usr/bin/env sh
set -e

# Improved install-and-run script for release bundles.
# Behaviors:
# - If a prebuilt server is available, run it directly.
# - If Node + pnpm are available, install deps and build/start.
# - If tools are missing, attempt best-effort install on Debian/Ubuntu.
# - As a last resort, run the project in Docker (if Docker present).

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$BASE_DIR/.." && pwd)"

# Prefer repository server directory if available
if [ -d "$REPO_ROOT/server" ]; then
  SERVER_DIR="$REPO_ROOT/server"
else
  SERVER_DIR="$BASE_DIR/server"
fi

PREBUILT_RELEASE_SERVER="$BASE_DIR/server/server.js"

if [ -f "$PREBUILT_RELEASE_SERVER" ]; then
  echo "Starting packaged server: $PREBUILT_RELEASE_SERVER"
  node "$PREBUILT_RELEASE_SERVER"
  exit 0
fi

if [ ! -d "$SERVER_DIR" ]; then
  echo "server directory not found at $SERVER_DIR" >&2
  exit 1
fi

cd "$SERVER_DIR"

# If already built, start it
if [ -f dist/server.js ]; then
  echo "Found built server at dist/server.js — starting"
  node dist/server.js
  exit 0
fi

# If server.js exists at top-level, start it
if [ -f server.js ]; then
  echo "Found prebuilt server.js — starting"
  node server.js
  exit 0
fi

# Ensure Node is present
if ! command -v node >/dev/null 2>&1; then
  echo "node not found"
  # Try to auto-install on Debian-like systems
  if command -v apt-get >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
    echo "Attempting to install Node via NodeSource (requires sudo)"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs build-essential
  else
    echo "Cannot install Node automatically on this platform. Please install Node.js (>=18) or use Docker." >&2
  fi
fi

# Ensure pnpm (via corepack or pnpm) available
if command -v corepack >/dev/null 2>&1; then
  corepack enable || true
  corepack prepare pnpm@latest --activate || true
elif command -v pnpm >/dev/null 2>&1; then
  echo "pnpm found"
elif command -v npm >/dev/null 2>&1; then
  echo "Installing pnpm via npm"
  npm install -g pnpm || true
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm still not available; attempting to continue with npm (may be slower)"
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm not available either — will attempt to run in Docker if available"
    if command -v docker >/dev/null 2>&1; then
      echo "Running via Docker: building image and starting container"
      cd "$REPO_ROOT"
      docker build -t media-renamer:latest .
      docker run --rm -p 8787:8787 media-renamer:latest
      exit 0
    else
      echo "Docker not available. Cannot continue." >&2
      exit 1
    fi
  fi
fi

# Install dependencies and build
if [ -f pnpm-lock.yaml ] || [ -f pnpm-lock.yml ]; then
  echo "Installing with pnpm (lockfile detected)"
  pnpm install --frozen-lockfile || pnpm install
else
  echo "Installing dependencies with pnpm"
  pnpm install || true
fi

# Build TypeScript
if [ -f tsconfig.json ]; then
  echo "Compiling TypeScript"
  if [ -x ./node_modules/.bin/tsc ]; then
    ./node_modules/.bin/tsc -p tsconfig.json
  elif command -v pnpm >/dev/null 2>&1; then
    pnpm exec tsc -p tsconfig.json
  elif command -v npx >/dev/null 2>&1; then
    npx tsc -p tsconfig.json
  else
    echo "No TypeScript compiler available; skipping build (expect runtime errors)" >&2
  fi
fi

echo "Starting server"
node dist/server.js

