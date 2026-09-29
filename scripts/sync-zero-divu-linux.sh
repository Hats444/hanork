#!/usr/bin/env bash
# Sincroniza código zero-divu Windows → Linux (sem node_modules).
# Uso: bash scripts/sync-zero-divu-linux.sh
set -euo pipefail

HANORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$HANORK_DIR/zero-divu"
TARGET="${ZERO_DIVU_LINUX_ROOT:-$HOME/hanork/zero-divu}"

if [ ! -d "$SRC" ]; then
  echo "[!] Origem não encontrada: $SRC"
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"
echo "→ Sync código: $SRC → $TARGET"
rsync -a --delete \
  --exclude node_modules \
  --exclude database/session \
  --exclude '*.log' \
  "$SRC/" "$TARGET/"

if [ -d "$SRC/database/session" ] && [ ! -d "$TARGET/database/session" ]; then
  echo "→ Copiando sessão WA (primeira vez)…"
  mkdir -p "$TARGET/database"
  rsync -a "$SRC/database/session/" "$TARGET/database/session/"
fi

echo "→ Verificando dependências nativas…"
cd "$TARGET"
npm install --no-audit --no-fund --prefer-offline 2>/dev/null || npm install --no-audit --no-fund
node scripts/verify-deps.js

echo ""
echo "✓ Sync concluído — reinicie: hanork-restart"
