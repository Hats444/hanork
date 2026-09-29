#!/bin/bash
# Banner Hanork — estilo MOTD Ubuntu (cores + status do bot)
# Uso: bash scripts/hanork-motd.sh

set -euo pipefail

BOT_DIR="${HANORK_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
PM2="${PM2_BIN:-$HOME/.nvm/versions/node/v20.20.2/bin/pm2}"

# Cores ANSI
R='\033[0m'
B='\033[1m'
D='\033[2m'
M='\033[35m'
C='\033[36m'
G='\033[32m'
Y='\033[33m'
W='\033[97m'
GR='\033[90m'

kv() {
  printf "${D}${GR}  ◆ %-14s${R} ${W}%s${R}\n" "$1" "$2"
}

host="$(hostname 2>/dev/null || echo linux)"
user="$(whoami 2>/dev/null || echo user)"
uptime_human="$(uptime -p 2>/dev/null | sed 's/up //' || uptime | sed 's/.*up //' | cut -d, -f1-2)"
load="$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || echo —)"
mem_line="$(free -h 2>/dev/null | awk '/^Mem:/ {print $3 " / " $2}' || echo —)"
disk_line="$(df -h "$BOT_DIR" 2>/dev/null | awk 'NR==2 {print $3 " / " $2 " (" $5 " usado)"}' || echo —)"
node_v="$(node -v 2>/dev/null || echo —)"

bot_status="${Y}offline${R}"
bot_pid="—"
if [ -x "$PM2" ]; then
  if "$PM2" pid hanork-bot >/dev/null 2>&1; then
    bot_pid="$("$PM2" pid hanork-bot 2>/dev/null | head -1)"
    bot_status="${G}online${R} (PID ${bot_pid})"
  fi
fi

pkg_ver="—"
if [ -f "$BOT_DIR/package.json" ]; then
  pkg_ver="$(node -e "console.log(require('$BOT_DIR/package.json').version)" 2>/dev/null || echo —)"
fi

echo ""
echo -e "${GR}══════════════════════════════════════════════════════════${R}"
echo -e "${B}${M}"
cat <<'LOGO'
  ██╗  ██╗ █████╗ ███╗   ██╗ ██████╗ ██████╗ ██╗  ██╗
  ██║  ██║██╔══██╗████╗  ██║██╔═══██╗██╔══██╗██║ ██╔╝
  ███████║███████║██╔██╗ ██║██║   ██║██████╔╝█████╔╝ 
  ██╔══██║██╔══██║██║╚██╗██║██║   ██║██╔══██╗██╔═██╗ 
  ██║  ██║██║  ██║██║ ╚████║╚██████╔╝██║  ██║██║  ██╗
  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝
LOGO
echo -e "${R}"
echo -e "${D}${C}  ── observability console · sales automation ──${R}"
echo -e "${GR}══════════════════════════════════════════════════════════${R}"
kv "Sessão" "${user}@${host}"
kv "Versão" "v${pkg_ver}"
kv "Pasta" "$BOT_DIR"
kv "Node" "$node_v"
kv "Uptime" "$uptime_human"
kv "Load" "$load"
kv "RAM" "$mem_line"
kv "Disco" "$disk_line"
kv "Hanork Bot" "$(echo -e "$bot_status")"
echo -e "${GR}══════════════════════════════════════════════════════════${R}"
echo -e "${D}${GR}  ▸ pm2 logs hanork-bot  ·  bash bot.sh restart${R}"
echo -e "${GR}══════════════════════════════════════════════════════════${R}"
echo ""
