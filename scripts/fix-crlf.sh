#!/usr/bin/env bash
# Converte scripts .sh para LF (WSL + /mnt/c/ com CRLF quebra "set -euo pipefail").
set -eu
HANORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for f in "$HANORK_DIR"/scripts/*.sh; do
  [ -f "$f" ] || continue
  if grep -q $'\r' "$f" 2>/dev/null; then
    tr -d '\r' < "$f" > "$f.lf"
    mv "$f.lf" "$f"
    echo "CRLF→LF: $(basename "$f")"
  fi
done
