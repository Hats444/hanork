#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:$PATH"
cd /home/vendetta/hanork

echo "=== better-sqlite3 ==="
if node -e 'require("better-sqlite3"); console.log("OK")' 2>/dev/null; then
  echo "better-sqlite3: OK"
else
  echo "better-sqlite3: REBUILD"
  npm rebuild better-sqlite3 --build-from-source 2>&1 | tail -5
  node -e 'require("better-sqlite3"); console.log("OK after rebuild")'
fi

echo "=== banner function ==="
if grep -nE '_hanork_print_banne([^r]|$)' scripts/hanork-terminal-welcome.sh; then
  echo "banner typo still present"
  exit 1
fi
echo "banner call OK"

echo "=== stop ==="
bash scripts/hanork-ctl.sh stop || true
sleep 2

echo "=== start-bg ==="
bash scripts/hanork-ctl.sh start-bg

echo "=== pgrep ==="
pgrep -af bot.js || true
