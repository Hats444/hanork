#!/bin/bash
# Configura PM2 para subir o Hanork no boot do Ubuntu (uma vez)
set -euo pipefail

PM2="${PM2_BIN:-/home/vendetta/.nvm/versions/node/v20.20.2/bin/pm2}"
BOT_DIR="${HANORK_DIR:-/home/vendetta/hanork}"

cd "$BOT_DIR"
bash scripts/cleanup-bot-lock.sh "$BOT_DIR" 2>/dev/null || true

echo "=== PM2 startup Hanork ==="
"$PM2" start ecosystem.config.js --env production 2>/dev/null || "$PM2" restart hanork-bot --update-env
"$PM2" save

echo ""
echo "Execute o comando que o PM2 imprimir abaixo (sudo env PATH=... pm2 startup ...):"
"$PM2" startup systemd -u "$(whoami)" --hp "$HOME"

echo ""
echo "No ~/.bashrc use APENAS (remova 'node src/bot.js' duplicado):"
echo "  cd $BOT_DIR && bash bot.sh boot"
