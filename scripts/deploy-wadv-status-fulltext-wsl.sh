#!/usr/bin/env bash
set -euo pipefail
HANORK="${HANORK_ROOT:-/home/vendetta/hanork}"
WIN="${WIN_HANORK:-/mnt/c/Users/boots/Downloads/hanork}"

echo "[deploy-wadv-status-fulltext] status com texto completo (sem sanitize assinante)…"

for f in \
  zero-divu/src/services/statusMessage.js \
  zero-divu/src/services/customBlast.js
do
  cp "$WIN/$f" "$HANORK/$f"
  sed -i 's/\r$//' "$HANORK/$f"
  node --check "$HANORK/$f"
done

cd "$HANORK"
bash scripts/hanork-ctl.sh stop || true
sleep 2
bash scripts/hanork-ctl.sh start-bg
sleep 35
BOT_PID=$(pgrep -f 'node src/bot.js' | head -1 || true)
echo "[deploy-wadv-status-fulltext] bot PID: ${BOT_PID:-none}"
