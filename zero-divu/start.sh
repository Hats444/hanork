#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

NC='\033[0m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
MAGENTA='\033[1;35m'

SESSION_DIR="./database/session"
LAST_METHOD_FILE="./database/last_method.txt"
MARKER_FILE="./database/.setup_ok"
WAKE_LOCK_PID=""

acquire_wake_lock() {
  if [[ -n "${TERMUX_VERSION:-}" ]] && command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock 2>/dev/null && WAKE_LOCK_PID="termux" && return 0
  fi
  return 1
}

release_wake_lock() {
  if [[ "$WAKE_LOCK_PID" == "termux" ]] && command -v termux-wake-unlock >/dev/null 2>&1; then
    termux-wake-unlock 2>/dev/null || true
    WAKE_LOCK_PID=""
  fi
}

trap release_wake_lock EXIT INT TERM

info() { echo -e "${CYAN}$*${NC}"; }
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
fail() { echo -e "${RED}❌ $*${NC}"; exit 1; }

install_git() {
  if command -v git >/dev/null 2>&1; then return 0; fi
  warn "Git não encontrado — instalando..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo apt-get install -y git
  else
    fail "Instale git manualmente e rode ./start.sh de novo"
  fi
  ok "Git instalado"
}

install_node() {
  if command -v node >/dev/null 2>&1; then return 0; fi
  warn "Node.js não encontrado — instalando Node 20..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    fail "Instale Node.js 18+ manualmente: https://nodejs.org"
  fi
  ok "Node $(node --version) instalado"
}

check_node_version() {
  if ! command -v node >/dev/null 2>&1; then return 1; fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  [[ "$major" -ge 18 ]]
}

ensure_dirs() {
  mkdir -p database/session src/database
  mkdir -p src/media/imagens src/media/videos src/media/audios src/media/stickers
}

needs_npm_install() {
  [[ ! -d node_modules ]] && return 0
  [[ ! -d node_modules/@kurtucoben/baileys ]] && return 0
  [[ ! -d node_modules/qrcode ]] && return 0
  [[ ! -d node_modules/qrcode-terminal ]] && return 0
  [[ ! -f "$MARKER_FILE" ]] && return 0
  [[ package.json -nt "$MARKER_FILE" ]] && return 0
  [[ package-lock.json -nt "$MARKER_FILE" ]] && return 0
  return 1
}

ensure_npm_deps() {
  if ! needs_npm_install; then
    ok "Dependências npm OK"
    return 0
  fi

  install_git
  info "Instalando dependências npm..."
  npm install
  date -Iseconds > "$MARKER_FILE" 2>/dev/null || echo "ok" > "$MARKER_FILE"
  ok "Dependências npm instaladas"
}

ensure_setup() {
  echo ""
  info "╔══════════════════════════════════════╗"
  info "║   ZERO DIVU — verificando ambiente   ║"
  info "╚══════════════════════════════════════╝"
  echo ""

  if [[ -n "${TERMUX_VERSION:-}" ]] && [[ -z "${WSL_DISTRO_NAME:-}" ]] && [[ ! -f /.proot-installed ]]; then
    ok "Termux detectado"
    if ! command -v termux-wake-lock >/dev/null 2>&1; then
      warn "termux-api não instalado — opcional: pkg install termux-api (wake-lock)"
    fi
  elif [[ -n "${WSL_DISTRO_NAME:-}" ]] || grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
    ok "Ubuntu/WSL detectado"
  elif [[ -f /etc/os-release ]] && grep -qiE '^id=ubuntu|^id=debian' /etc/os-release; then
    ok "Ubuntu/Linux detectado"
  fi

  install_node

  if ! check_node_version; then
    fail "Node 18+ necessário. Versão atual: $(node --version 2>/dev/null || echo 'n/a')"
  fi
  ok "Node $(node --version) | npm $(npm --version)"

  ensure_dirs
  ensure_npm_deps

  echo ""
  ok "Ambiente pronto!"
  echo ""
}

show_banner() {
  clear
  printf "${MAGENTA}"
  cat << 'EOF'
  ╔══════════════════════════════════════╗
  ║         ZERO DIVU — WhatsApp         ║
  ║   Divulgação inteligente em grupos   ║
  ╚══════════════════════════════════════╝
EOF
  printf "${NC}"
}

start_bot() {
  local method="$1"
  echo "$method" > "$LAST_METHOD_FILE"

  if acquire_wake_lock; then
    ok "Wake-lock Termux ativo (evita suspensão em background)"
  fi

  # Encerra instância anterior do bot (mesma sessão, sem apagar database/session)
  if command -v pgrep >/dev/null 2>&1; then
    local old_pids
    old_pids="$(pgrep -f "node connect.js" 2>/dev/null || true)"
    if [[ -n "$old_pids" ]]; then
      warn "Encerrando instância(s) anterior(es) do bot…"
      echo "$old_pids" | xargs -r kill -TERM 2>/dev/null || true
      sleep 2
      echo "$old_pids" | xargs -r kill -KILL 2>/dev/null || true
      sleep 1
    fi
  fi

  while true; do
    local restart_delay=15
    if [[ -f "./database/runtime/last-exit.json" ]]; then
      restart_delay="$(node -e "
        try {
          const j=require('./database/runtime/last-exit.json');
          const n=(j.count||0)+1;
          require('fs').writeFileSync('./database/runtime/last-exit.json', JSON.stringify({count:n,at:new Date().toISOString()}));
          const d=Math.min(120, 15*n);
          process.stdout.write(String(d));
        } catch(e) { process.stdout.write('15'); }
      " 2>/dev/null || echo 15)"
    else
      mkdir -p database/runtime
      echo '{"count":0}' > "./database/runtime/last-exit.json"
    fi

    if [[ "$method" == "qr" ]]; then
      printf "${GREEN}[+] Conectando via QR Code...${NC}\n\n"
      node connect.js
      local exit_code=$?
    else
      printf "${GREEN}[+] Conectando via código de pareamento...${NC}\n\n"
      node connect.js --code
      local exit_code=$?
    fi

    if [[ "$exit_code" == "0" ]]; then
      echo '{"count":0}' > "./database/runtime/last-exit.json" 2>/dev/null || true
    fi

    printf "\n${YELLOW}Bot encerrado.${NC}\n"
    if [[ "${ZERO_DIVU_NO_RESTART:-}" == "1" ]]; then
      break
    fi
    printf "${YELLOW}Reiniciando em ${restart_delay}s... (Ctrl+C para sair · export ZERO_DIVU_NO_RESTART=1 para desligar auto-restart)${NC}\n"
    sleep "$restart_delay"
  done
}

auto_start() {
  if [[ -d "$SESSION_DIR" ]] && [[ -f "$LAST_METHOD_FILE" ]]; then
    local method
    method="$(cat "$LAST_METHOD_FILE")"
    if [[ -n "$(find "$SESSION_DIR" -type f 2>/dev/null | head -1)" ]]; then
      printf "${GREEN}[+] Sessão detectada — reconectando ($method)...${NC}\n"
      sleep 2
      start_bot "$method"
    fi
  fi
}

show_menu() {
  show_banner
  printf "${CYAN}1)${NC} Conectar via QR Code\n"
  printf "${CYAN}2)${NC} Conectar via código (--code)\n"
  printf "${CYAN}3)${NC} Limpar sessão (logout)\n"
  printf "${CYAN}0)${NC} Sair\n"
  printf "${MAGENTA}❯${NC} Escolha: "
}

# --- main ---
ensure_setup
auto_start

while true; do
  show_menu
  read -r choice
  case "$choice" in
    1) start_bot "qr" ;;
    2) start_bot "code" ;;
    3)
      printf "${RED}Apagar sessão? (s/n): ${NC}"
      read -r confirm
      if [[ "$confirm" =~ ^[sS]$ ]]; then
        rm -rf "$SESSION_DIR"
        rm -f "$LAST_METHOD_FILE"
        printf "${GREEN}Sessão removida.${NC}\n"
        sleep 2
      fi
      ;;
    0) exit 0 ;;
    *) printf "${RED}Opção inválida.${NC}\n"; sleep 1 ;;
  esac
done
