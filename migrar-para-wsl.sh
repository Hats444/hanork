#!/bin/bash
# Script de migração definitiva - Hanork Bot para WSL (ext4)
# Este script move o bot da pasta Windows (que corrompe) para dentro do WSL
#
# Uso: HANORK_WIN_SRC=/mnt/c/Users/SEU_USUARIO/Downloads/hanork ./migrar-para-wsl.sh

set -euo pipefail

WIN_SRC="${HANORK_WIN_SRC:-}"
if [ -z "$WIN_SRC" ] || [ ! -d "$WIN_SRC" ]; then
  echo "Defina HANORK_WIN_SRC com o caminho do projeto no WSL."
  echo "Exemplo: HANORK_WIN_SRC=/mnt/c/Users/SEU_USUARIO/Downloads/hanork ./migrar-para-wsl.sh"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  MIGRAÇÃO HANORK BOT → WSL (EXT4)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Parar o bot atual
echo -e "${YELLOW}[1/8]${NC} Parando bot atual..."
pm2 stop all 2>/dev/null || true
sleep 2

# 2. Criar pasta definitiva no WSL (ext4)
echo -e "${YELLOW}[2/8]${NC} Criando pasta ~/hanork-bot..."
mkdir -p ~/hanork-bot
mkdir -p ~/hanork-bot/logs
mkdir -p ~/hanork-bot/backups
mkdir -p ~/hanork-bot/produtos
mkdir -p ~/hanork-bot/fotos
mkdir -p ~/hanork-bot/infos

# 3. Copiar arquivos essenciais (SEM node_modules!)
echo -e "${YELLOW}[3/8]${NC} Copiando arquivos (isso pode levar alguns segundos)..."

# Código fonte
cp -r "$WIN_SRC/src" ~/hanork-bot/

# Arquivos públicos (dashboard)
cp -r "$WIN_SRC/public" ~/hanork-bot/ 2>/dev/null || echo "  Public não encontrado, pulando..."

# Configurações (copie .env manualmente se existir — não versionado no Git)
if [ -f "$WIN_SRC/.env" ]; then
  cp "$WIN_SRC/.env" ~/hanork-bot/
else
  echo "  .env não encontrado — copie de .env.example após a migração"
fi
cp "$WIN_SRC/.env.example" ~/hanork-bot/ 2>/dev/null || true
cp "$WIN_SRC/package.json" ~/hanork-bot/
cp "$WIN_SRC/ecosystem.config.js" ~/hanork-bot/ 2>/dev/null || true
cp "$WIN_SRC/bot.sh" ~/hanork-bot/ 2>/dev/null || true
cp "$WIN_SRC/nginx.conf" ~/hanork-bot/ 2>/dev/null || true
cp "$WIN_SRC/README.md" ~/hanork-bot/ 2>/dev/null || true

# Banco de dados (se existir localmente — não versionado no Git)
echo -e "${YELLOW}[4/8]${NC} Copiando banco de dados (se existir)..."
cp "$WIN_SRC/hanork.db" ~/hanork-bot/ 2>/dev/null || true
cp "$WIN_SRC/hanork.db-shm" ~/hanork-bot/ 2>/dev/null || true
cp "$WIN_SRC/hanork.db-wal" ~/hanork-bot/ 2>/dev/null || true

# Fotos e produtos (se existirem — não versionados no Git)
cp -r "$WIN_SRC/fotos/"* ~/hanork-bot/fotos/ 2>/dev/null || true
cp -r "$WIN_SRC/produtos/"* ~/hanork-bot/produtos/ 2>/dev/null || true
cp "$WIN_SRC/infos/"* ~/hanork-bot/infos/ 2>/dev/null || true

echo -e "${GREEN}✓ Arquivos copiados!${NC}"

# 5. Instalar dependências do zero
echo -e "${YELLOW}[5/8]${NC} Instalando dependências (npm install)..."
cd ~/hanork-bot
rm -rf node_modules package-lock.json
npm install

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Erro no npm install${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Dependências instaladas!${NC}"

# 6. Recompilar better-sqlite3
echo -e "${YELLOW}[6/8]${NC} Recompilando better-sqlite3..."
npm rebuild better-sqlite3

# Testar se funcionou
node -e "require('better-sqlite3'); console.log('✓ SQLite OK')" 2>/dev/null
if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Erro no better-sqlite3${NC}"
    echo "Tentando novamente com npm rebuild..."
    npm rebuild
fi

# 7. Atualizar ecosystem.config.js
echo -e "${YELLOW}[7/8]${NC} Atualizando configurações..."
if [ -f ~/hanork-bot/ecosystem.config.js ]; then
    sed -i "s|${WIN_SRC}|/home/$(whoami)/hanork-bot|g" ~/hanork-bot/ecosystem.config.js
    echo -e "${GREEN}✓ ecosystem.config.js atualizado!${NC}"
fi

# 8. Criar atalho fácil
echo -e "${YELLOW}[8/8]${NC} Criando atalhos..."
cat > ~/bot << 'EOF'
#!/bin/bash
cd ~/hanork-bot
case "$1" in
  logs) pm2 logs hanork-bot ;;
  restart) pm2 restart hanork-bot ;;
  stop) pm2 stop hanork-bot ;;
  start) pm2 start ecosystem.config.js ;;
  status) pm2 status ;;
  *) echo "Uso: bot [logs|restart|stop|start|status]" ;;
esac
EOF
chmod +x ~/bot

# Criar script de atualização
cat > ~/hanork-bot/update.sh << EOF
#!/bin/bash
cd ~/hanork-bot
npm install
npm rebuild better-sqlite3
pm2 restart hanork-bot
EOF
chmod +x ~/hanork-bot/update.sh

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}  ✅ MIGRAÇÃO CONCLUÍDA!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📁 Novo local: ${YELLOW}~/hanork-bot${NC}"
echo ""
echo "🚀 Para iniciar o bot agora:"
echo "   ${YELLOW}cd ~/hanork-bot && pm2 start ecosystem.config.js${NC}"
echo ""
echo "📋 Comandos disponíveis:"
echo "   ${YELLOW}~/bot logs${NC}     → Ver logs em tempo real"
echo "   ${YELLOW}~/bot restart${NC}  → Reiniciar bot"
echo "   ${YELLOW}~/bot stop${NC}     → Parar bot"
echo "   ${YELLOW}~/bot status${NC}   → Ver status"
echo "   ${YELLOW}~/bot start${NC}    → Iniciar bot"
echo ""
echo "🔄 Se der erro no futuro, execute:"
echo "   ${YELLOW}~/hanork-bot/update.sh${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚠️  IMPORTANTE: Agora você DEVE usar"
echo "   a pasta ~/hanork-bot, não mais"
echo "   ${WIN_SRC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
