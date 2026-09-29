#!/usr/bin/env bash
# Sincroniza .env completo Windows → produção WSL (preserva backup).
set -euo pipefail
SRC="/mnt/c/Users/boots/Downloads/hanork/.env"
DEST="/home/vendetta/hanork/.env"
TS="$(date +%Y%m%d-%H%M%S)"

if [ ! -f "$SRC" ]; then
  echo "Origem não encontrada: $SRC"
  exit 1
fi

cp -a "$DEST" "${DEST}.bak.${TS}" 2>/dev/null || true
cp -a "$SRC" "$DEST"
chmod 600 "$DEST"
echo "OK: .env sincronizado → $DEST"
echo "Backup: ${DEST}.bak.${TS}"
