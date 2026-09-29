#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
cd /home/vendetta/hanork

echo "[*] Reinstalando better-sqlite3 nativo..."
rm -rf node_modules/better-sqlite3
npm install better-sqlite3 --omit=dev --no-save
node -e "require('better-sqlite3')(':memory:'); console.log('sqlite OK')"

bash scripts/hanork-ctl.sh start-bg
sleep 90
bash scripts/hanork-ctl.sh status
node scripts/validate-production.js || true
node scripts/verify-wadv-v5a.js
