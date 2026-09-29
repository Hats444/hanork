#!/usr/bin/env bash
# Hanork — banner + dashboard (bash/zsh). Sourced from # HANORK START block.
# Não executar diretamente em shell não-interativo.

_hanork_welcome_guard() {
  case $- in
    *i*) ;;
    *) return 0 ;;
  esac
  if [ -n "${HANORK_WELCOME_SHOWN:-}" ] && [ "${HANORK_FORCE_WELCOME:-0}" != "1" ]; then
    return 0
  fi
  export HANORK_WELCOME_SHOWN=1
}

_hanork_print_banner() {
  local ver
  ver="$(cd "$HANORK_ROOT" 2>/dev/null && node -p "require('./package.json').version" 2>/dev/null || echo '?.?.?')"
  if command -v figlet >/dev/null 2>&1; then
    if command -v lolcat >/dev/null 2>&1; then
      figlet -f standard 'HANORK' 2>/dev/null | lolcat 2>/dev/null || figlet -f standard 'HANORK' 2>/dev/null
    else
      figlet -f standard 'HANORK' 2>/dev/null
    fi
  elif command -v toilet >/dev/null 2>&1; then
    toilet -f mono12 -F metal 'HANORK' 2>/dev/null
  else
    cat <<'EOF'
██╗  ██╗ █████╗ ███╗   ██╗ ██████╗ ██████╗ ██╗  ██╗
██║  ██║██╔══██╗████╗  ██║██╔═══██╗██╔══██╗██║ ██╔╝
███████║███████║██╔██╗ ██║██║   ██║██████╔╝█████╔╝
██╔══██║██╔══██║██║╚██╗██║██║   ██║██╔══██╗██╔═██╗
██║  ██║██║  ██║██║ ╚████║╚██████╔╝██║  ██║██║  ██╗
╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝
EOF
  fi
  echo ""
  echo "Hanork Platform"
  echo "Telegram Commerce Engine"
  echo "Version: ${ver}"
  echo ""
}

_hanork_pct() {
  local used="$1" total="$2"
  if [ -z "$total" ] || [ "$total" -eq 0 ] 2>/dev/null; then
    echo "n/a"
    return
  fi
  echo $(( used * 100 / total ))%
}

_hanork_service_status() {
  local name="$1" check_cmd="$2"
  if eval "$check_cmd" >/dev/null 2>&1; then
    printf '%s: \033[32mONLINE\033[0m\n' "$name"
  else
    printf '%s: \033[31mOFFLINE\033[0m\n' "$name"
  fi
}

_hanork_bot_running() {
  local root="${HANORK_ROOT:-}"
  [ -n "$root" ] && [ -d "$root" ] || return 1
  if [ -f "$root/scripts/hanork-ctl.sh" ]; then
    bash "$root/scripts/hanork-ctl.sh" status 2>/dev/null | grep -q 'Bot rodando'
    return $?
  fi
  local pid
  [ -f "$root/.bot.lock" ] || return 1
  pid=$(tr -d '[:space:]' < "$root/.bot.lock" 2>/dev/null)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  if [ -r "/proc/$pid/cmdline" ]; then
    tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q 'src/bot.js' || return 1
  fi
  return 0
}

_hanork_show_dashboard() {
  local host user local_ip pub_ip os_ver uptime_line cpu ram disk
  host="$(hostname 2>/dev/null || echo '?')"
  user="$(whoami 2>/dev/null || echo '?')"
  local_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' || echo '?')"
  pub_ip="$(curl -fsS --max-time 2 https://api.ipify.org 2>/dev/null || echo 'n/a')"
  os_ver="$(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-Linux}" || echo 'Linux')"
  uptime_line="$(uptime -p 2>/dev/null || uptime 2>/dev/null | sed 's/^.*up /up /' || echo 'n/a')"

  if command -v mpstat >/dev/null 2>&1; then
    cpu="$(mpstat 1 1 2>/dev/null | awk '/Average/ {print 100-$NF"%"}' | tail -1)"
  else
    cpu="$(grep 'cpu ' /proc/stat 2>/dev/null | awk '{u=$2+$4; t=$2+$4+$5; if(t>0) printf "%d%%", (u*100/t); else print "n/a"}')"
  fi
  [ -n "$cpu" ] || cpu="n/a"

  if command -v free >/dev/null 2>&1; then
    read -r ram_total ram_used <<<"$(free -m 2>/dev/null | awk '/^Mem:/ {print $2, $3}')"
    ram="$(_hanork_pct "$ram_used" "$ram_total")"
  else
    ram="n/a"
  fi

  if command -v df >/dev/null 2>&1; then
    read -r disk_used disk_total <<<"$(df -BM / 2>/dev/null | awk 'NR==2 {gsub(/M/,"",$3); gsub(/M/,"",$2); print $3, $2}')"
    disk="$(_hanork_pct "$disk_used" "$disk_total")"
  else
    disk="n/a"
  fi

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "HOST: ${host}  |  USER: ${user}"
  echo "IP Local: ${local_ip}  |  IP Público: ${pub_ip}"
  echo "OS: ${os_ver}"
  echo "Uptime: ${uptime_line}"
  echo ""
  echo "HANORK STATUS"
  echo ""
  echo "CPU: ${cpu}"
  echo "RAM: ${ram}"
  echo "DISK: ${disk}"
  echo ""
  _hanork_service_status Redis 'redis-cli ping 2>/dev/null | grep -q PONG'
  _hanork_service_status PostgreSQL 'pg_isready -q 2>/dev/null || systemctl is-active --quiet postgresql 2>/dev/null'
  _hanork_service_status PM2 'command -v pm2 >/dev/null && pm2 ping 2>/dev/null'
  if _hanork_bot_running; then
    local hp
    hp="$(bash "${HANORK_ROOT}/scripts/hanork-ctl.sh" status 2>/dev/null | sed -n 's/.*PID \([0-9]*\).*/\1/p' | head -1)"
    if [ -n "$hp" ]; then
      printf 'Hanork: \033[32mONLINE\033[0m (PID %s)\n' "$hp"
    else
      printf '%s: \033[32mONLINE\033[0m\n' 'Hanork'
    fi
  else
    printf '%s: \033[31mOFFLINE\033[0m\n' 'Hanork'
  fi
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
}

_hanork_show_sysinfo() {
  if command -v fastfetch >/dev/null 2>&1; then
    fastfetch --pipe false 2>/dev/null || fastfetch 2>/dev/null
    echo ""
    return
  fi
  if command -v neofetch >/dev/null 2>&1; then
    neofetch 2>/dev/null
    echo ""
  fi
}

_hanork_setup_aliases() {
  local root="${HANORK_ROOT:-}"
  [ -n "$root" ] && [ -d "$root" ] || return 0
  alias hanork="cd \"$root\" && bash scripts/hanork-boot.sh"
  alias hanork-start="cd \"$root\" && bash scripts/hanork-boot.sh"
  alias hanork-stop="cd \"$root\" && bash scripts/hanork-ctl.sh stop"
  alias hanork-restart="cd \"$root\" && bash scripts/hanork-ctl.sh restart"
  alias hanork-status="cd \"$root\" && bash scripts/hanork-ctl.sh status"
  alias hanork-logs='bash -c "L=${HANORK_TERMINAL_LOG:-$HOME/.hanork/terminal.log}; M=$(grep -n \"Nova sessão Hanork\" \"$L\" 2>/dev/null | tail -1 | cut -d: -f1); [ -n \"$M\" ] && tail -n +$M -F \"$L\" || tail -F \"$L\""'
  alias hanork-terminal-restore="cd \"$root\" && npm run terminal:restore"
}

_hanork_source_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  [ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
}

_hanork_clean_node_options() {
  if [ -z "${NODE_OPTIONS:-}" ]; then
    return 0
  fi
  local cleaned=() w v
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

# Primeiro terminal após login/reboot sobe o bot; extras só seguem logs se já estiver online.
_hanork_autostart_bot() {
  export HANORK_AUTOSTART="${HANORK_AUTOSTART:-1}"
  export HANORK_TERMINAL_LOG="${HANORK_TERMINAL_LOG:-$HOME/.hanork/terminal.log}"
  local root="${HANORK_ROOT:-}"
  [ -n "$root" ] && [ -d "$root" ] || return 0
  [ "$HANORK_AUTOSTART" = "1" ] || return 0
  if [ -n "${HANORK_BOT_STARTED:-}" ]; then
    return 0
  fi
  export HANORK_BOT_STARTED=1
  _hanork_source_nvm
  _hanork_clean_node_options
  bash "$root/scripts/hanork-boot.sh" || true
}

_hanork_terminal_welcome() {
  _hanork_welcome_guard || return 0
  [ -n "${HANORK_ROOT:-}" ] || return 0
  command -v clear >/dev/null 2>&1 && clear || true
  _hanork_setup_aliases
  _hanork_print_banner
  _hanork_show_sysinfo
  _hanork_autostart_bot
  _hanork_show_dashboard
}

_hanork_terminal_welcome
