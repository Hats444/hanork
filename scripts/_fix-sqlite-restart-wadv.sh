#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:${PATH}"
cd /home/vendetta/hanork

echo "[1] install better-sqlite3"
npm install better-sqlite3 --no-save 2>&1 | tail -5
node scripts/ensure-native-sqlite.js 2>&1 | tail -5

echo "[2] restart"
./scripts/hanork-ctl.sh restart-bg
sleep 30
./scripts/hanork-ctl.sh status

echo "[3] boot markers"
grep -E 'Polling Telegram|BOOT-FATAL|WaDivulgacao.*ativo' /home/vendetta/.hanork/terminal.log | tail -6

curl -sf http://127.0.0.1:3000/health/live && echo " HEALTH_OK" || echo " HEALTH_PENDING"
