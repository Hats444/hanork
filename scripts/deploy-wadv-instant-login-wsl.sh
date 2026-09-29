#!/usr/bin/env bash
set -euo pipefail
HANORK="${HANORK_ROOT:-/home/vendetta/hanork}"
WIN="${WIN_HANORK:-/mnt/c/Users/boots/Downloads/hanork}"

echo "[deploy-wadv-instant-login] sync login instantâneo (Zero Two style)…"
for f in \
  zero-divu/connect.js \
  zero-divu/src/ipc/operations.js \
  zero-divu/src/ipc/server.js \
  zero-divu/src/ipc/runtimeBridge.js \
  src/utils/defer.js \
  src/modules/wa-divulgacao/waDivulgacaoClient.js \
  src/modules/wa-divulgacao/waDivulgacaoWorkerService.js \
  src/modules/wa-divulgacao/waDivulgacaoLoginService.js \
  src/modules/wa-divulgacao/waDivulgacaoCopy.js \
  src/core/UserHandlers.js \
  src/modules/wa-divulgacao/callbacks/waDivulgacaoHandlers.js
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
echo "[deploy-wadv-instant-login] bot PID: ${BOT_PID:-none}"
bash scripts/node-hanork.sh scripts/validate-production.js
