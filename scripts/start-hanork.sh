#!/usr/bin/env bash
# Inicia o bot Hanork na pasta do projeto (WSL-safe)
# Atalho opcional — o fluxo padrão é: node src/bot.js
set -euo pipefail

sanitize_node_options() {
  local opts="${NODE_OPTIONS:-}"
  if [[ -z "$opts" ]]; then
    echo ""
    return 0
  fi

  local out=()
  local w
  for w in $opts; do
    if [[ "$w" == "--localstorage-file" ]]; then
      continue
    fi
    if [[ "$w" == --localstorage-file=* ]]; then
      local v="${w#--localstorage-file=}"
      if [[ -z "$v" ]]; then
        continue
      fi
    fi
    out+=("$w")
  done

  (IFS=' '; echo "${out[*]}")
}

export NODE_OPTIONS
NODE_OPTIONS="$(sanitize_node_options)"

HANORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HANORK_DIR"

# nvm — alinha Node com .nvmrc (evita MODULE_VERSION mismatch no better-sqlite3)
if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [[ -f .nvmrc ]]; then
    nvm use --silent 2>/dev/null || { nvm install --silent && nvm use --silent; }
  fi
fi

node scripts/ensure-native-modules.js

# WSL: garante banco fora do drvfs (/mnt/c) se .env não definiu
if [[ "$HANORK_DIR" == /mnt/* ]] && [[ -z "${HANORK_DB_PATH:-}" ]]; then
  export HANORK_DB_PATH="${HOME}/.hanork/hanork.db"
  export SQLITE_JOURNAL_MODE="${SQLITE_JOURNAL_MODE:-DELETE}"
fi
if [[ -z "${ZERO_DIVU_DB_PATH:-}" ]]; then
  export ZERO_DIVU_DB_PATH="${HOME}/.zero-divu/zero-divu.db"
fi
export ZERO_DIVU_USE_HANORK_DB="${ZERO_DIVU_USE_HANORK_DB:-0}"

mkdir -p "$(dirname "${HANORK_DB_PATH:-${HOME}/.hanork/hanork.db}")"
mkdir -p "$(dirname "${ZERO_DIVU_DB_PATH}")"
mkdir -p "${HANORK_DIR}/shared/zero-ipc"
mkdir -p "${HANORK_DIR}/uploads"

exec node src/bot.js
