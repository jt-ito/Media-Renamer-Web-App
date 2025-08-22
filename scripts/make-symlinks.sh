#!/usr/bin/env bash
# make-symlinks.sh
# Usage: make-symlinks.sh <input-path-on-host> <output-path-on-host> [base-dir] [--force]
# Creates symlinks <base-dir>/input and <base-dir>/output pointing to the provided host paths.
# base-dir defaults to $MR_BASE_DIR, or $HOME/containers/media-renamer if not set.

set -euo pipefail

INPUT=${1:-}
OUTPUT=${2:-}
ARG3=${3:-}
ARG4=${4:-}

FORCE=false
if [ "${ARG3}" = "--force" ] || [ "${ARG4}" = "--force" ]; then FORCE=true; fi

# Choose base dir: explicit third arg > env MR_BASE_DIR > default to $HOME/containers/media-renamer
if [ -n "${ARG3}" ] && [ "${ARG3}" != "--force" ]; then
  BASE_DIR="${ARG3}"
else
  BASE_DIR="${MR_BASE_DIR:-$HOME/containers/media-renamer}"
fi

if [ -z "$INPUT" ] && [ -z "$OUTPUT" ]; then
  echo "Usage: $0 <input-path-on-host> <output-path-on-host> [base-dir] [--force]"
  echo "Example: $0 /mnt/sda1/Tor /data/renamed ${BASE_DIR} --force"
  exit 2
fi

mkdir -p "$BASE_DIR"

if [ -n "$INPUT" ]; then
  TARGET_INPUT="$INPUT"
  LINK_INPUT="$BASE_DIR/input"
  if [ -e "$LINK_INPUT" ] || [ -L "$LINK_INPUT" ]; then
    if [ "$FORCE" = true ]; then rm -rf "$LINK_INPUT"; else echo "Link $LINK_INPUT exists; use --force to replace"; fi
  fi
  ln -s "$TARGET_INPUT" "$LINK_INPUT"
  echo "Created symlink: $LINK_INPUT -> $TARGET_INPUT"
fi

if [ -n "$OUTPUT" ]; then
  TARGET_OUTPUT="$OUTPUT"
  LINK_OUTPUT="$BASE_DIR/output"
  if [ -e "$LINK_OUTPUT" ] || [ -L "$LINK_OUTPUT" ]; then
    if [ "$FORCE" = true ]; then rm -rf "$LINK_OUTPUT"; else echo "Link $LINK_OUTPUT exists; use --force to replace"; fi
  fi
  ln -s "$TARGET_OUTPUT" "$LINK_OUTPUT"
  echo "Created symlink: $LINK_OUTPUT -> $TARGET_OUTPUT"
fi
