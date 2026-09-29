#!/usr/bin/env bash
# Wrapper visual — neofetch (se ainda não exibido) + boot do bot
# Uso: bash scripts/hanork-boot.sh  ·  aliases hanork / hanork-start
set +e

HANORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HANORK_DIR" || exit 0
CTL="$HANORK_DIR/scripts/hanork-ctl.sh"
TERMINAL_LOG="${HANORK_TERMINAL_LOG:-$HOME/.hanork/terminal.log}"

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

_hanork_clean_node_options() {
  if [ -z "${NODE_OPTIONS:-}" ]; then
    return 0
  fi
  local cleaned=()
  local w v
  for w in $NODE_OPTIONS; do
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

_hanork_show_welcome() {
  if [ -n "${HANORK_WELCOME_SHOWN:-}" ] && [ "${HANORK_FORCE_WELCOME:-0}" != "1" ]; then
    return 0
  fi
  export HANORK_WELCOME_SHOWN=1
  unset HANORK_FORCE_WELCOME
  # Neofetch/fastfetch só com opt-in — evita poluir logs do boot Hanork
  if [ "${HANORK_SHOW_NEOFETCH:-0}" = "1" ]; then
    command -v clear >/dev/null 2>&1 && clear || true
    if command -v fastfetch >/dev/null 2>&1; then
      fastfetch --pipe false 2>/dev/null || fastfetch 2>/dev/null
      echo ""
    elif command -v neofetch >/dev/null 2>&1; then
      neofetch 2>/dev/null
      echo ""
    fi
  fi
}

_hanork_running_pid() {
  bash "$CTL" status 2>/dev/null | sed -n 's/^\[✓\] Bot rodando — PID \([0-9][0-9]*\)$/\1/p' | head -1
}

_hanork_session_marker_line() {
  local want_pid="${1:-}"
  [ -n "$want_pid" ] || return 1
  [ -f "$TERMINAL_LOG" ] || return 1
  grep -a -n "Nova sessão Hanork (PID ${want_pid})" "$TERMINAL_LOG" 2>/dev/null \
    | head -1 \
    | cut -d: -f1
}

_hanork_wait_session_marker() {
  local want_pid="${1:-}"
  local max_wait="${2:-90}"
  local i marker_line=""
  [ -n "$want_pid" ] || return 1
  for i in $(seq 1 "$max_wait"); do
    marker_line=$(_hanork_session_marker_line "$want_pid" 2>/dev/null || true)
    if [ -n "$marker_line" ]; then
      echo "$marker_line"
      return 0
    fi
    kill -0 "$want_pid" 2>/dev/null || return 1
    sleep 1
  done
  return 1
}

_hanork_log_tail_from() {
  local follow="${1:-0}"
  local want_pid="${2:-}"
  if [ ! -f "$TERMINAL_LOG" ]; then
    return 1
  fi
  if [ -z "$want_pid" ]; then
    want_pid=$(_hanork_running_pid 2>/dev/null || true)
  fi
  local marker_line=""
  if [ -n "$want_pid" ]; then
    marker_line=$(_hanork_wait_session_marker "$want_pid" 90 2>/dev/null || true)
  fi
  if [ -z "$marker_line" ]; then
    marker_line=$(
      grep -a -n "Nova sessão Hanork" "$TERMINAL_LOG" 2>/dev/null \
        | tail -1 \
        | cut -d: -f1
    )
  fi
  if [ -n "$marker_line" ] && [ "$marker_line" -gt 0 ] 2>/dev/null; then
    if [ "$follow" = "1" ]; then
      tail -n +"$marker_line" -F "$TERMINAL_LOG"
    else
      tail -n +"$marker_line" "$TERMINAL_LOG" | tail -n 120
    fi
  elif [ "$follow" = "1" ]; then
    tail -n 120 -F "$TERMINAL_LOG"
  else
    tail -n 120 "$TERMINAL_LOG"
  fi
}

_hanork_follow_logs() {
  local pid="$1"
  local live_pid
  live_pid="$(_hanork_running_pid 2>/dev/null || true)"
  if [ -n "$live_pid" ]; then
    pid="$live_pid"
  fi
  printf '\033[0;32m[✓] Hanork ativo (PID %s) — conectando aos logs…\033[0m\n' "$pid"
  printf '\033[0;33m    Fechar este terminal NÃO para o bot (modo background).\033[0m\n'
  printf '\033[0;36m    Logs ao vivo — Ctrl+C só fecha este terminal (bot continua)\033[0m\n'
  printf '    Parar:     hanork-stop\n'
  printf '    Reiniciar: hanork-restart\n'
  printf '    Status:    hanork-status\n\n'
  if [ ! -f "$TERMINAL_LOG" ]; then
    printf '\033[0;33m[…] Aguardando log…\033[0m\n\n'
    local i
    for i in $(seq 1 90); do
      [ -f "$TERMINAL_LOG" ] && break
      live_pid="$(_hanork_running_pid 2>/dev/null || true)"
      [ -n "$live_pid" ] && pid="$live_pid"
      sleep 1
    done
  fi
  if [ -f "$TERMINAL_LOG" ]; then
    if command -v pgrep >/dev/null 2>&1; then
      while IFS= read -r _tpid; do
        [ -n "$_tpid" ] || continue
        kill -TERM "$_tpid" 2>/dev/null || true
      done < <(pgrep -f "tail.*${TERMINAL_LOG}" 2>/dev/null || true)
    fi
    _hanork_log_tail_from 1 "$pid"
    live_pid="$(_hanork_running_pid 2>/dev/null || true)"
    if [ -z "$live_pid" ]; then
      printf '\n\033[0;31m[!] Hanork parado — subir: hanork-start\033[0m\n\n'
    fi
    return 0
  fi
  printf '\033[0;31m[!] Log não encontrado: %s\033[0m\n' "$TERMINAL_LOG"
}

_hanork_source_nvm

_hanork_clean_node_options

# Rotação terminal.log (>200 MB ou >7 dias) — não bloqueia o boot
if [ -f "$HANORK_DIR/scripts/rotate-terminal-log.sh" ]; then
  HANORK_TERMINAL_LOG="$TERMINAL_LOG" bash "$HANORK_DIR/scripts/rotate-terminal-log.sh" >/dev/null 2>&1 &
fi

if ! command -v node >/dev/null 2>&1; then
  printf '\033[0;33m[!] node não encontrado — instale Node 25 (nvm use 25)\033[0m\n'
  exit 0
fi

_hanork_show_welcome

_running_pid="$(_hanork_running_pid 2>/dev/null || true)"
if [ -n "$_running_pid" ]; then
  _hanork_follow_logs "$_running_pid"
  exit 0
fi

# Lock órfão — só remove se o PID morreu e não há node src/bot.js subindo
if [ -f "$HANORK_DIR/.bot.lock" ]; then
  _lock_pid="$(tr -d '[:space:]' < "$HANORK_DIR/.bot.lock" 2>/dev/null || true)"
  if [ -z "$_lock_pid" ] || ! kill -0 "$_lock_pid" 2>/dev/null; then
    if [ -z "$(bash "$CTL" status 2>/dev/null | sed -n 's/^\[✓\] Bot rodando — PID \([0-9][0-9]*\)$/\1/p')" ]; then
      _booting="$(pgrep -f 'src/bot\.js' 2>/dev/null | head -1 || true)"
      if [ -z "$_booting" ]; then
        rm -f "$HANORK_DIR/.bot.lock" 2>/dev/null || true
      fi
    fi
  fi
fi

printf '\033[0;32m[✓] Iniciando Hanork (background — terminal pode fechar sem parar o bot)…\033[0m\n\n'

bash "$HANORK_DIR/scripts/rotate-terminal-log.sh" 2>/dev/null || true

if ! bash "$CTL" start-bg; then
  exit 1
fi

_new_pid="$(_hanork_running_pid 2>/dev/null || true)"
_hanork_follow_logs "${_new_pid:-unknown}"
exit 0
