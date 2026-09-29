#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v25.2.1/bin:/home/vendetta/.nvm/versions/node/v20.20.2/bin:${PATH}"
cd /home/vendetta/hanork

echo "[fix-native] rebuilding hanork better-sqlite3..."
rm -rf node_modules/better-sqlite3/build
npm rebuild better-sqlite3

echo "[fix-native] rebuilding zero-divu better-sqlite3..."
cd zero-divu
rm -rf node_modules/better-sqlite3/build
npm rebuild better-sqlite3
node scripts/verify-deps.js
cd ..

echo "[fix-native] starting bot..."
bash scripts/hanork-ctl.sh start-bg
sleep 35
bash scripts/hanork-ctl.sh status

echo "[fix-native] processes:"
pgrep -af bot.js || true
pgrep -af connect.js || true

echo "[fix-native] restore wa admin..."
node scripts/restore-wa-admin.js 2>&1 || true
sleep 10

echo "[fix-native] processes after restore:"
pgrep -af bot.js || true
pgrep -af connect.js || true

echo "[fix-native] validate..."
node scripts/validate-production.js
