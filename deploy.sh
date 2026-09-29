#!/bin/bash
# =============================================================================
# Deploy script para atualizar e reiniciar o bot Hanork no Ubuntu
# Execute no servidor: bash deploy.sh
# =============================================================================

set -e

PM2="/home/vendetta/.nvm/versions/node/v20.20.2/bin/pm2"
BOT_DIR="/home/vendetta/hanork"

echo "=== Hanork Bot Deploy ==="
echo ""

# ── 1. Parar bot atual ──────────────────────────────────────────────────────────
echo "[1/4] Parando bot atual..."
cd "$BOT_DIR"
$PM2 stop hanork-bot || echo "  Bot não estava rodando"
echo "  ✓ Bot parado"

# ── 2. Atualizar código ───────────────────────────────────────────────────────────
echo ""
echo "[2/4] Atualizando código..."
git pull origin main || git pull origin master
echo "  ✓ Código atualizado"

# ── 3. Instalar dependências ─────────────────────────────────────────────────────
echo ""
echo "[3/4] Instalando dependências..."
npm install --production
echo "  ✓ Dependências instaladas"

# ── 4. Reiniciar bot ────────────────────────────────────────────────────────────
echo ""
echo "[4/4] Reiniciando bot..."
$PM2 restart hanork-bot
$PM2 save --silent
echo "  ✓ Bot reiniciado"

echo ""
echo "=== Deploy concluído! ==="
echo ""
echo "  Status PM2:"
$PM2 list
echo ""
echo "  Logs recentes:"
$PM2 logs hanork-bot --lines 20 --nostream
