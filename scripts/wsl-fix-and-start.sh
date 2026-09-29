#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin:/usr/sbin:/sbin"
HANORK=/home/vendetta/hanork
WIN=/mnt/c/Users/boots/Downloads/hanork

/bin/cp -f "$WIN/scripts/ensure-native-sqlite.js" "$HANORK/scripts/ensure-native-sqlite.js"

echo "=== hanork sqlite binary ==="
ls -la "$HANORK/node_modules/better-sqlite3/build/Release/better_sqlite3.node" 2>&1 || true

echo "=== zero-divu sqlite binary ==="
ls -la "$HANORK/zero-divu/node_modules/better-sqlite3/build/Release/better_sqlite3.node" 2>&1 || true

echo "=== ensure native ==="
cd "$HANORK"
node scripts/ensure-native-sqlite.js

echo "=== start-bg ==="
bash scripts/hanork-ctl.sh stop || true
sleep 2
bash scripts/hanork-ctl.sh start-bg

echo "=== pgrep ==="
sleep 5
pgrep -af bot.js || true
bash scripts/hanork-ctl.sh status
