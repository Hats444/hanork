#!/usr/bin/env bash
# Wrapper — limpa NODE_OPTIONS inválido e fixa Node LTS (v20) antes do boot.
set -euo pipefail

HANORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HANORK_DIR"

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

# GramJS / Node 25+: --localstorage-file exige path válido (Cursor/WSL às vezes injeta flag vazia).
sanitize_node_options() {
  local opts="${NODE_OPTIONS:-}"
  if [ -z "$opts" ]; then
    return 0
  fi
  local cleaned=()
  local w v
  for w in $opts; do
    case "$w" in
      --localstorage-file) continue ;;
      --localstorage-file=*)
        v="${w#--localstorage-file=}"
        [ -n "$v" ] && cleaned+=("$w")
        ;;
      *) cleaned+=("$w") ;;
    esac
  done
  if [ "${#cleaned[@]}" -eq 0 ]; then
    unset NODE_OPTIONS
  else
    NODE_OPTIONS="${cleaned[*]}"
    export NODE_OPTIONS
  fi
}
sanitize_node_options

# Node 25+ exige path válido para GramJS; v20 ignora e quebra se a flag estiver em NODE_OPTIONS.
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -ge 25 ]; then
  GRAMJS_LS="${HANORK_DIR}/data/gramjs-localstorage"
  mkdir -p "$GRAMJS_LS"
  _ls_flag="--localstorage-file=${GRAMJS_LS}"
  if [ -z "${NODE_OPTIONS:-}" ]; then
    export NODE_OPTIONS="$_ls_flag"
  elif [[ " ${NODE_OPTIONS} " != *" ${_ls_flag} "* ]] \
    && [[ "${NODE_OPTIONS}" != *"--localstorage-file="* ]]; then
    export NODE_OPTIONS="${NODE_OPTIONS} ${_ls_flag}"
  fi
  unset _ls_flag
fi

export HANORK_TERMINAL_LOG="${HANORK_TERMINAL_LOG:-$HOME/.hanork/terminal.log}"
# Console + arquivo no foreground; só start-bg define HANORK_LOG_BG=1 (log só no arquivo).
if [ "${HANORK_LOG_BG:-}" = "1" ]; then
  export HANORK_LOG_BG=1
else
  unset HANORK_LOG_BG
fi

exec node src/bot.js "$@"
