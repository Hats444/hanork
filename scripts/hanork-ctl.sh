#!/usr/bin/env bash
# Controle do Hanork: status | stop | start | start-bg | restart | autostart
set -euo pipefail

HANORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HANORK_DIR"
TERMINAL_LOG="${HANORK_TERMINAL_LOG:-$HOME/.hanork/terminal.log}"

ACTION="${1:-status}"

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

# Node 25+ quebra com --localstorage-file sem path (warning antes do JS carregar).
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

_hanork_source_nvm

_hanork_clean_node_options

# WSL + /mnt/c/: scripts Windows (CRLF) quebram "set -euo pipefail"
_hanork_strip_crlf_scripts() {
  local f
  for f in "$HANORK_DIR/scripts/"*.sh; do
    [ -f "$f" ] || continue
    if grep -q $'\r' "$f" 2>/dev/null; then
      if sed -i 's/\r$//' "$f" 2>/dev/null; then
        echo "[i] CRLF→LF: $(basename "$f")"
      else
        tr -d '\r' < "$f" > "$f.lf" && mv "$f.lf" "$f"
        echo "[i] CRLF→LF (tr): $(basename "$f")"
      fi
    fi
  done
}

_hanork_pid_alive() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  local st
  st=$(ps -p "$pid" -o stat= 2>/dev/null | tr -d ' ')
  [[ "$st" == *Z* ]] && return 1
  if [ -r "/proc/$pid/cmdline" ]; then
    tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q 'src/bot.js' || return 1
  fi
  return 0
}

_hanork_lock_pid() {
  local dir="$1"
  [ -f "$dir/.bot.lock" ] || return 1
  local pid
  pid=$(cat "$dir/.bot.lock" 2>/dev/null | tr -d '[:space:]')
  [ -n "$pid" ] || return 1
  _hanork_pid_alive "$pid" || return 1
  echo "$pid"
  return 0
}

_hanork_pgrep_bot_pids() {
  local dir="$1"
  if ! command -v pgrep >/dev/null 2>&1; then
    return 0
  fi
  local pid cwd cmdline
  for pid in $(pgrep -f 'src/bot\.js' 2>/dev/null); do
    [ -n "$pid" ] || continue
    cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
    cmdline=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    if [ "$cwd" = "$dir" ] || [[ "$cmdline" == *"$dir"* ]]; then
      echo "$pid"
    fi
  done
}

_hanork_show_log_tail() {
  local lines="${1:-40}"
  if [ ! -f "$TERMINAL_LOG" ]; then
    echo "[!] Log não encontrado: $TERMINAL_LOG"
    echo "    Rode em foreground para ver o erro: cd \"$HANORK_DIR\" && node src/bot.js"
    return 1
  fi
  echo ""
  if grep -q '\[BOOT-FATAL\]' "$TERMINAL_LOG" 2>/dev/null; then
    echo "─── erro de boot (BOOT-FATAL) ───"
    grep '\[BOOT-FATAL\]' "$TERMINAL_LOG" 2>/dev/null | tail -n 5 || true
    echo ""
  fi
  echo "─── últimas ${lines} linhas de $TERMINAL_LOG ───"
  tail -n "$lines" "$TERMINAL_LOG" 2>/dev/null || true
  echo "──────────────────────────────────────────────"
  echo "    Ver ao vivo: tail -F $TERMINAL_LOG"
  echo "    Diagnóstico: cd \"$HANORK_DIR\" && node src/bot.js"
  return 0
}

# Mata node src/bot.js órfão (sem lock válido) — evita boot travado.
_hanork_cleanup_stale_boot() {
  local dir="$1"
  local pid lock_pid
  lock_pid=$(_hanork_lock_pid "$dir" 2>/dev/null) || true
  if [ -n "$lock_pid" ]; then
    return 0
  fi
  if [ -f "$dir/.bot.lock" ]; then
    local stale
    stale=$(tr -d '[:space:]' < "$dir/.bot.lock" 2>/dev/null || true)
    if [ -n "$stale" ] && ! _hanork_pid_alive "$stale"; then
      rm -f "$dir/.bot.lock" 2>/dev/null || true
      echo "[i] Lock órfão removido (.bot.lock PID morto)"
    fi
  fi
  local pids
  pids=$(_hanork_pgrep_bot_pids "$dir" 2>/dev/null | tr '\n' ' ')
  if [ -z "$pids" ]; then
    return 0
  fi
  for pid in $pids; do
    [ -n "$pid" ] || continue
    echo "[*] Encerrando boot órfão (PID $pid) — sem lock válido…"
    kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 2
  for pid in $pids; do
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  done
  rm -f "$dir/.bot.lock" 2>/dev/null || true
}

_hanork_running_pid() {
  local dir="$1"
  local pid
  pid=$(_hanork_lock_pid "$dir" 2>/dev/null) || true
  if [ -n "$pid" ]; then
    echo "$pid"
    return 0
  fi
  pid=$(_hanork_pgrep_bot_pids "$dir" 2>/dev/null | head -1)
  if [ -n "$pid" ]; then
    echo "$pid"
    return 0
  fi
  return 1
}

_hanork_acquire_start_lock() {
  local lockfile="$HANORK_DIR/.hanork-start.lock"
  local wait_sec="${HANORK_START_LOCK_WAIT_SEC:-45}"
  exec {HANORK_START_FD}>"$lockfile"
  if ! flock -n "$HANORK_START_FD"; then
    echo "[…] Outro start Hanork em andamento — aguardando (máx ${wait_sec}s)…"
    if ! flock -w "$wait_sec" "$HANORK_START_FD"; then
      echo "[!] Lock de start expirado — limpando lock órfão…"
      rm -f "$lockfile"
      exec {HANORK_START_FD}>"$lockfile"
      flock -n "$HANORK_START_FD" || {
        echo "[!] Não foi possível obter lock de start — tente: rm -f $lockfile"
        return 1
      }
    fi
  fi
}

cmd_status() {
  _hanork_cleanup_stale_boot "$HANORK_DIR" 2>/dev/null || true
  local pid
  pid=$(_hanork_running_pid "$HANORK_DIR" 2>/dev/null) || true
  if [ -n "$pid" ]; then
    echo "[✓] Bot rodando — PID $pid"
  else
    echo "[ ] Bot parado — node src/bot.js"
  fi
}

cmd_stop() {
  local pid
  pid=$(_hanork_running_pid "$HANORK_DIR" 2>/dev/null) || true
  if [ -z "$pid" ]; then
    rm -f "$HANORK_DIR/.bot.lock" "$HANORK_DIR/.hanork-start.lock" 2>/dev/null || true
    echo "[ ] Bot não estava rodando"
    return 0
  fi
  echo "[*] Parando Hanork (PID $pid)..."
  kill -TERM "$pid" 2>/dev/null || true
  local i
  for i in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$HANORK_DIR/.bot.lock" "$HANORK_DIR/.hanork-start.lock" 2>/dev/null || true
      echo "[✓] Bot parado"
      return 0
    fi
    sleep 1
  done
  kill -KILL "$pid" 2>/dev/null || true
  if command -v pgrep >/dev/null 2>&1; then
    for zpid in $(pgrep -f 'zero-divu.*connect\.js' 2>/dev/null); do
      kill -TERM "$zpid" 2>/dev/null || true
    done
  fi
  rm -f "$HANORK_DIR/.bot.lock" "$HANORK_DIR/.hanork-start.lock" 2>/dev/null || true
  echo "[✓] Bot encerrado (SIGKILL)"
}

cmd_restart() {
  _hanork_strip_crlf_scripts
  cmd_stop
  sleep 1
  export HANORK_FORCE_WELCOME=1
  echo "[*] Reiniciando Hanork…"
  exec bash "$HANORK_DIR/scripts/hanork-boot.sh"
}

cmd_start() {
  exec bash "$HANORK_DIR/scripts/hanork-boot.sh"
}

cmd_start_fg() {
  _hanork_strip_crlf_scripts
  local pid
  pid=$(_hanork_running_pid "$HANORK_DIR" 2>/dev/null) || true
  if [ -n "$pid" ]; then
    echo "[✓] Bot já rodando — PID $pid (pare antes: hanork-stop)"
    exit 1
  fi
  _hanork_cleanup_stale_boot "$HANORK_DIR"
  unset HANORK_LOG_BG
  export HANORK_TERMINAL_LOG="$TERMINAL_LOG"
  echo "[*] Iniciando Hanork em foreground — logs neste terminal + $TERMINAL_LOG"
  exec bash "$HANORK_DIR/scripts/node-hanork.sh"
}

cmd_start_bg() {
  _hanork_strip_crlf_scripts

  local pid i
  pid=$(_hanork_running_pid "$HANORK_DIR" 2>/dev/null) || true
  if [ -n "$pid" ]; then
    echo "[✓] Bot já rodando — PID $pid"
    rm -f "$HANORK_DIR/.hanork-start.lock" 2>/dev/null || true
    return 0
  fi

  _hanork_acquire_start_lock

  pid=$(_hanork_running_pid "$HANORK_DIR" 2>/dev/null) || true
  if [ -n "$pid" ]; then
    echo "[✓] Bot já rodando — PID $pid"
    exec {HANORK_START_FD}>&- 2>/dev/null || true
    return 0
  fi

  # Evita segundo nohup enquanto o primeiro node ainda não gravou .bot.lock (~1 min de boot).
  for i in $(seq 1 30); do
    pid=$(_hanork_pgrep_bot_pids "$HANORK_DIR" 2>/dev/null | head -1)
    if [ -n "$pid" ]; then
      echo "[…] Bot iniciando (PID $pid) — aguardando lock… ($i/30)"
      sleep 2
      pid=$(_hanork_running_pid "$HANORK_DIR" 2>/dev/null) || true
      if [ -n "$pid" ]; then
        echo "[✓] Bot já rodando — PID $pid"
        return 0
      fi
    else
      break
    fi
  done

  pid=$(_hanork_running_pid "$HANORK_DIR" 2>/dev/null) || true
  if [ -n "$pid" ]; then
    echo "[✓] Bot já rodando — PID $pid"
    return 0
  fi

  _hanork_cleanup_stale_boot "$HANORK_DIR"

  mkdir -p "$(dirname "$TERMINAL_LOG")"
  export HANORK_TERMINAL_LOG="$TERMINAL_LOG"
  export HANORK_LOG_BG=1
  local log_lines_before=0
  if [ -f "$TERMINAL_LOG" ]; then
    log_lines_before=$(wc -l < "$TERMINAL_LOG" 2>/dev/null | tr -d '[:space:]' || echo 0)
  fi
  echo "[*] Iniciando Hanork em background (nohup)…"
  echo "[i] Boot completo pode levar 2–3 min (Zero Divu + recovery)."
  exec {HANORK_START_FD}>&- 2>/dev/null || true
  nohup bash "$HANORK_DIR/scripts/node-hanork.sh" </dev/null >/dev/null 2>>"$TERMINAL_LOG" &
  local nohup_pid=$!
  disown 2>/dev/null || true

  local booting="" booting_was=""
  # Até ~4 min (120 × 2s) — boot real já mediu ~2m14s com Zero Divu ON
  for i in $(seq 1 120); do
    sleep 2
    pid=$(_hanork_running_pid "$HANORK_DIR" 2>/dev/null) || true
    if [ -n "$pid" ]; then
      echo "[✓] Bot em background — PID $pid"
      echo "    Logs: tail -F $TERMINAL_LOG"
      return 0
    fi
    if [ -f "$TERMINAL_LOG" ]; then
      if tail -n +"$((log_lines_before + 1))" "$TERMINAL_LOG" 2>/dev/null | grep -q '\[BOOT-FATAL\]'; then
        echo "[!] Boot abortado — erro registrado no log."
        _hanork_show_log_tail 30
        return 1
      fi
    fi
    booting=$(_hanork_pgrep_bot_pids "$HANORK_DIR" 2>/dev/null | head -1)
    if [ -n "$booting" ]; then
      if [ $((i % 15)) -eq 0 ]; then
        echo "[…] Bot iniciando (PID $booting) — aguardando lock… ($i/120)"
      fi
    elif [ "$i" -ge 4 ] && { [ -n "${booting_was:-}" ] || ! kill -0 "$nohup_pid" 2>/dev/null; }; then
      echo "[!] Processo de boot encerrou antes de ficar pronto."
      _hanork_show_log_tail 50
      return 1
    fi
    [ -n "$booting" ] && booting_was=1
  done

  echo "[!] Falha ao subir — timeout aguardando .bot.lock"
  _hanork_show_log_tail 50
  echo ""
  echo "    Tente: bash scripts/hanork-ctl.sh stop && bash scripts/hanork-ctl.sh restart"
  return 1
}

case "$ACTION" in
  status) cmd_status ;;
  stop) cmd_stop ;;
  start) cmd_start ;;
  start-fg) cmd_start_fg ;;
  start-bg) cmd_start_bg ;;
  restart) cmd_restart ;;
  terminal)
    sub="${2:-}"
    case "$sub" in
      restore) node "$HANORK_DIR/scripts/hanork-terminal.js" restore ;;
      init|install) node "$HANORK_DIR/scripts/hanork-terminal.js" init "${@:3}" ;;
      *)
        echo "Uso: $0 terminal {init|restore}"
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Uso: $0 {status|stop|restart|start|start-fg|start-bg|terminal}  — iniciar: bash scripts/hanork-boot.sh"
    exit 1
    ;;
esac
