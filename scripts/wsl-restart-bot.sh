#!/usr/bin/env bash
# Mata bots Hanork órfãos, deploy completo e sobe em background (produção WSL).
set -euo pipefail

export PATH="/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
DL="/mnt/c/Users/boots/Downloads/hanork"
PROD="/home/vendetta/hanork"

echo "[*] Deploy código → $PROD"
bash "$DL/scripts/deploy-hanork-promos.sh"

echo "[*] Terminal → HANORK_ROOT em ~/hanork (evita CRLF /mnt/c)..."
node "$PROD/scripts/hanork-terminal.js" init --force 2>/dev/null || true

echo "[*] Zero Divu deps (WSL)..."
bash "$PROD/scripts/setup-zero-divu-wsl.sh" 2>&1 | tail -20

echo "[*] Parando instâncias antigas..."
pkill -f 'src/bot\.js' 2>/dev/null || true
pkill -f 'hanork-boot\.sh' 2>/dev/null || true
sleep 2
pkill -9 -f 'src/bot\.js' 2>/dev/null || true
rm -f "$PROD/.bot.lock" "$PROD/.hanork-start.lock" 2>/dev/null || true

cd "$PROD"
echo "[*] Subindo bot (start-bg)..."
bash scripts/hanork-ctl.sh start-bg

echo "[*] Status:"
bash scripts/hanork-ctl.sh status
