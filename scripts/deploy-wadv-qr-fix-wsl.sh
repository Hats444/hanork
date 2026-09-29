#!/usr/bin/env bash
set -euo pipefail
HANORK="${HANORK_ROOT:-/home/vendetta/hanork}"
WIN="${WIN_HANORK:-/mnt/c/Users/boots/Downloads/hanork}"

echo "[deploy-wadv-qr-fix] sync QR login fix…"
cp "$WIN/zero-divu/connect.js" "$HANORK/zero-divu/connect.js"
cp "$WIN/src/modules/wa-divulgacao/waDivulgacaoLoginService.js" \
   "$HANORK/src/modules/wa-divulgacao/waDivulgacaoLoginService.js"
for f in "$HANORK/zero-divu/connect.js" "$HANORK/src/modules/wa-divulgacao/waDivulgacaoLoginService.js"; do
  sed -i 's/\r$//' "$f"
  node --check "$f"
done

cd "$HANORK"
bash scripts/hanork-ctl.sh stop || true
sleep 2
bash scripts/hanork-ctl.sh start-bg
sleep 35
BOT_PID=$(pgrep -f 'node src/bot.js' | head -1 || true)
echo "[deploy-wadv-qr-fix] bot PID: ${BOT_PID:-none}"
bash scripts/node-hanork.sh scripts/validate-production.js
