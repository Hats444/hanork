#!/usr/bin/env bash
set -euo pipefail

NODE20=/home/vendetta/.nvm/versions/node/v20.20.2/bin
export PATH="$NODE20:/usr/bin:/bin"
HANORK=/home/vendetta/hanork

install_pkg() {
  local label="$1"
  local dir="$2"
  echo "[install] $label"
  cd "$dir"
  if [ ! -f node_modules/better-sqlite3/package.json ]; then
    "$NODE20/npm" install better-sqlite3 --no-save 2>&1 | tail -5
  fi
  "$NODE20/npm" rebuild better-sqlite3 2>&1 | tail -3
  "$NODE20/node" -e "const createRequire=require('module').createRequire; createRequire('$dir/package.json')('better-sqlite3')(':memory:'); console.log('probe OK $label')"
}

install_pkg hanork "$HANORK"
install_pkg zero-divu "$HANORK/zero-divu"

cd "$HANORK"
bash scripts/hanork-ctl.sh start-bg
echo "waiting 90s…"
sleep 90

BOT_PID=$(pgrep -f 'node src/bot.js' | head -1 || true)
echo "bot PID: ${BOT_PID:-none}"
HEALTH=$(curl -s -m 10 http://127.0.0.1:3000/health/live || echo FAIL)
echo "health: $HEALTH"
pgrep -af connect.js | head -4 || true

"$NODE20/node" scripts/validate-production.js 2>&1 | tail -12
