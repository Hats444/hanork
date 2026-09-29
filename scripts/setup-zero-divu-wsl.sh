#!/usr/bin/env bash
# Prepara zero-divu no WSL: módulos nativos Linux + dependências (qified, better-sqlite3).
# Uso: bash scripts/setup-zero-divu-wsl.sh
#      bash scripts/setup-zero-divu-wsl.sh --copy   # copia de /mnt/c para ~/hanork/zero-divu
set -euo pipefail

HANORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HANORK_DIR"

COPY_TO_LINUX=false
for arg in "$@"; do
  case "$arg" in
    --copy) COPY_TO_LINUX=true ;;
  esac
done

_hanork_source_nvm() {
  local node25="${HOME}/.nvm/versions/node/v25.2.1/bin"
  if [ -x "${node25}/node" ]; then
    export PATH="${node25}:${PATH}"
    return 0
  fi
  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    export PATH="${NVM_DIR}/versions/node/v25.2.1/bin:${PATH}"
  fi
}

_hanork_source_nvm

ZERO_SRC="$HANORK_DIR/zero-divu"
ZERO_TARGET="${ZERO_DIVU_LINUX_ROOT:-$HOME/hanork/zero-divu}"

if $COPY_TO_LINUX || echo "$ZERO_SRC" | grep -q '^/mnt/'; then
  echo "→ Copiando zero-divu para disco Linux: $ZERO_TARGET"
  mkdir -p "$(dirname "$ZERO_TARGET")"
  rsync -a --delete \
    --exclude node_modules \
    --exclude database/session \
    --exclude '*.log' \
    "$ZERO_SRC/" "$ZERO_TARGET/"
  ZERO_SRC="$ZERO_TARGET"
  echo ""
  echo "Adicione ao .env do Hanork:"
  echo "  ZERO_DIVU_ROOT=$ZERO_TARGET"
  echo ""
fi

echo "→ npm install em: $ZERO_SRC"
cd "$ZERO_SRC"
npm install --no-audit --no-fund

echo "→ Rebuild better-sqlite3 (binário Linux/WSL)"
npm rebuild better-sqlite3

echo "→ Verificando dependências nativas"
node scripts/verify-deps.js

echo ""
echo "✓ zero-divu pronto no WSL"
echo "  Reinicie: hanork-restart"
