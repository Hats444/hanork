#!/usr/bin/env bash
set -euo pipefail
SRC="${HANORK_SRC:-/mnt/c/Users/boots/Downloads/hanork}"
DST="${HANORK_DST:-/home/vendetta/hanork}"
FILES=(
  src/plugins/zero-divu/waIpcHelper.js
  src/modules/wa-divulgacao/waDivulgacaoCopy.js
  src/modules/wa-divulgacao/handlers/waDivulgacaoUiHandlers.js
)
for rel in "${FILES[@]}"; do
  install -D -m 0644 "$SRC/$rel" "$DST/$rel"
  sed -i 's/\r$//' "$DST/$rel"
  node --check "$DST/$rel"
  echo "synced $rel"
done
echo "OK"
