#!/usr/bin/env bash
# Rotação leve de terminal.log — chamado no boot (não bloqueia).
# Uso: bash scripts/rotate-terminal-log.sh
set -euo pipefail

HANORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="${HANORK_TERMINAL_LOG:-$HOME/.hanork/terminal.log}"

_hanork_source_nvm() {
  local ver cand bin
  local candidates=()
  if [ -n "${HANORK_NODE_VERSION:-}" ]; then
    candidates+=("${HANORK_NODE_VERSION}")
  fi
  if [ -f "$HANORK_DIR/.nvmrc" ]; then
    candidates+=("$(tr -d '[:space:]' < "$HANORK_DIR/.nvmrc")")
  fi
  candidates+=(v20.20.2 v18.19.1)
  for cand in "${candidates[@]}"; do
    [ -n "$cand" ] || continue
    ver="$cand"
    case "$ver" in
      v*) ;;
      *) ver="v${ver}" ;;
    esac
    bin="${HOME}/.nvm/versions/node/${ver}/bin"
    if [ -x "${bin}/node" ]; then
      export PATH="${bin}:${PATH}"
      return 0
    fi
  done
  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    nvm use 20 >/dev/null 2>&1 || nvm use 18 >/dev/null 2>&1 || true
  fi
}

_hanork_source_nvm

if command -v node >/dev/null 2>&1 && [ -f "$HANORK_DIR/scripts/rotate-terminal-log.js" ]; then
  HANORK_TERMINAL_LOG="$LOG_FILE" node "$HANORK_DIR/scripts/rotate-terminal-log.js"
  exit 0
fi

# Fallback bash (sem Node)
MAX_BYTES=$((200 * 1024 * 1024))
MAX_AGE_SEC=$((7 * 24 * 60 * 60))
KEEP=5
ARCHIVE_DIR="$(dirname "$LOG_FILE")/archive"

[ -f "$LOG_FILE" ] || exit 0

size=$(stat -c%s "$LOG_FILE" 2>/dev/null || stat -f%z "$LOG_FILE" 2>/dev/null || echo 0)
mtime=$(stat -c%Y "$LOG_FILE" 2>/dev/null || stat -f%m "$LOG_FILE" 2>/dev/null || echo 0)
now=$(date +%s)
age=$((now - mtime))

if [ "$size" -le "$MAX_BYTES" ] && [ "$age" -le "$MAX_AGE_SEC" ]; then
  exit 0
fi

mkdir -p "$ARCHIVE_DIR"
ts=$(date +%Y-%m-%d-%H%M%S)
archive="$ARCHIVE_DIR/terminal-${ts}.log.gz"
gzip -c "$LOG_FILE" > "$archive"
: > "$LOG_FILE"

ls -1t "$ARCHIVE_DIR"/terminal-*.log.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old"
done

echo "[rotate-terminal-log] $LOG_FILE → $archive"
