#!/bin/bash
# ============================================================================
# 🤖 HANORK BOT - Script de Instalação e Inicialização Completo
# ============================================================================
# Uso: bash iniciar.sh
# ============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✅ $1${NC}"; }
info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
err()  { echo -e "${RED}❌ $1${NC}"; }
step() { echo -e "\n${CYAN}${BOLD}▶ $1${NC}"; }

echo ""
echo -e "${GREEN}${BOLD}"
echo "  ██╗  ██╗ █████╗ ███╗   ██╗ ██████╗ ██████╗ ██╗  ██╗"
echo "  ██║  ██║██╔══██╗████╗  ██║██╔═══██╗██╔══██╗██║ ██╔╝"
echo "  ███████║███████║██╔██╗ ██║██║   ██║██████╔╝█████╔╝ "
echo "  ██╔══██║██╔══██║██║╚██╗██║██║   ██║██╔══██╗██╔═██╗ "
echo "  ██║  ██║██║  ██║██║ ╚████║╚██████╔╝██║  ██║██║  ██╗"
echo "  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝"
echo -e "${NC}"
echo -e "${BOLD}             🤖 BOT DE VENDAS v3.0 🤖${NC}"
echo -e "${YELLOW}         Instalação e Inicialização Automática${NC}"
echo ""

HANORK_DIR="$HOME/hanork"
SRC_WIN="/mnt/c/Users/boots/Downloads/hanork"

# ============================================================================
# ETAPA 1: NVM / NODE
# ============================================================================
step "Verificando Node.js..."

export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    info "Instalando NVM..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
else
    \. "$NVM_DIR/nvm.sh" --silent
fi

if ! node -v &>/dev/null || [[ "$(node -v)" != v20* ]]; then
    info "Instalando Node.js 20..."
    nvm install 20 --silent
fi
nvm use 20 --silent
ok "Node $(node -v) | npm $(npm -v)"

# ============================================================================
# ETAPA 2: PM2
# ============================================================================
step "Verificando PM2..."

if ! command -v pm2 &>/dev/null; then
    info "Instalando PM2..."
    npm install -g pm2 --silent
    ok "PM2 instalado"
else
    ok "PM2 já instalado ($(pm2 -v))"
fi

# ============================================================================
# ETAPA 3: SINCRONIZAR ARQUIVOS DO WINDOWS (se disponível)
# ============================================================================
step "Sincronizando arquivos..."

mkdir -p "$HANORK_DIR/src"

if [ -d "$SRC_WIN/src" ]; then
    cp -r "$SRC_WIN/src/"* "$HANORK_DIR/src/" 2>/dev/null
    cp "$SRC_WIN/package.json" "$HANORK_DIR/" 2>/dev/null
    cp "$SRC_WIN/ecosystem.config.js" "$HANORK_DIR/" 2>/dev/null
    cp "$SRC_WIN/.env" "$HANORK_DIR/" 2>/dev/null
    ok "Arquivos sincronizados do Windows"
else
    warn "Pasta Windows não encontrada. Usando arquivos locais."
fi

# ============================================================================
# ETAPA 4: DEPENDÊNCIAS NODE
# ============================================================================
step "Instalando dependências Node.js..."

cd "$HANORK_DIR"

if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
    info "Rodando npm install..."
    npm install --silent
    ok "Dependências instaladas"
else
    # Verificar se tem atualizações
    npm install --silent 2>/dev/null
    ok "Dependências OK"
fi

# ============================================================================
# ETAPA 5: OLLAMA
# ============================================================================
step "Verificando Ollama (IA Local)..."

if ! command -v ollama &>/dev/null; then
    info "Instalando Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
    ok "Ollama instalado"
else
    ok "Ollama já instalado ($(ollama -v 2>/dev/null || echo 'ok'))"
fi

# Iniciar Ollama em background se não estiver rodando
if ! curl -s http://localhost:11434/ &>/dev/null; then
    info "Iniciando Ollama em background..."
    ollama serve &>/tmp/ollama.log &
    OLLAMA_PID=$!
    info "Aguardando Ollama iniciar..."
    for i in {1..15}; do
        sleep 1
        if curl -s http://localhost:11434/ &>/dev/null; then
            ok "Ollama iniciou (PID $OLLAMA_PID)"
            break
        fi
        if [ $i -eq 15 ]; then
            warn "Ollama demorou para iniciar. Continuando sem IA local."
        fi
    done
else
    ok "Ollama já está rodando"
fi

# Baixar modelo se não existir
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2:1b}"

# Pegar modelo do .env se existir
if [ -f "$HANORK_DIR/.env" ]; then
    ENV_MODEL=$(grep "^OLLAMA_MODEL=" "$HANORK_DIR/.env" | cut -d= -f2 | tr -d '"' | tr -d "'")
    [ -n "$ENV_MODEL" ] && OLLAMA_MODEL="$ENV_MODEL"
fi

if curl -s http://localhost:11434/ &>/dev/null; then
    if ! ollama list 2>/dev/null | grep -q "${OLLAMA_MODEL%%:*}"; then
        info "Baixando modelo $OLLAMA_MODEL (pode demorar)..."
        ollama pull "$OLLAMA_MODEL"
        ok "Modelo $OLLAMA_MODEL baixado"
    else
        ok "Modelo $OLLAMA_MODEL já disponível"
    fi
fi

# ============================================================================
# ETAPA 6: INICIAR BOT
# ============================================================================
step "Iniciando Hanork Bot..."

cd "$HANORK_DIR"

# Verificar .env
if [ ! -f ".env" ]; then
    err ".env não encontrado! Crie o arquivo .env antes de continuar."
    exit 1
fi

# Parar instância anterior se existir
pm2 delete hanork-bot &>/dev/null || true

# Iniciar com PM2
pm2 start ecosystem.config.js --env production 2>/dev/null
pm2 save --silent 2>/dev/null

sleep 3

# Verificar se subiu
STATUS=$(pm2 describe hanork-bot 2>/dev/null | grep "status" | grep -c "online" || echo "0")
if [ "$STATUS" -ge 1 ] 2>/dev/null || pm2 list | grep -q "online"; then
    ok "Bot iniciado com sucesso!"
else
    err "Bot não iniciou corretamente. Verifique os logs abaixo."
fi

# ============================================================================
# STATUS FINAL
# ============================================================================
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║       🤖 HANORK BOT - STATUS FINAL       ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""
pm2 list
echo ""
echo -e "${CYAN}${BOLD}📋 Comandos úteis:${NC}"
echo -e "  ${GREEN}bash bot.sh restart${NC}  - Reiniciar bot"
echo -e "  ${GREEN}bash bot.sh stop${NC}     - Parar bot"
echo -e "  ${GREEN}bash bot.sh logs${NC}     - Ver logs"
echo -e "  ${GREEN}pm2 monit${NC}            - Monitor em tempo real"
echo ""

# ============================================================================
# ETAPA 7: LOGS AO VIVO (últimos 500 + stream)
# ============================================================================
echo -e "${YELLOW}${BOLD}══════════════════════════════════════════${NC}"
echo -e "${YELLOW}${BOLD}  📜 LOGS (últimos 500 + tempo real)       ${NC}"
echo -e "${YELLOW}${BOLD}  Pressione Ctrl+C para sair               ${NC}"
echo -e "${YELLOW}${BOLD}══════════════════════════════════════════${NC}"
echo ""

pm2 logs hanork-bot --lines 500
