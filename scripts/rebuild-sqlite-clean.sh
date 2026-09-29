#!/usr/bin/env bash
set -euo pipefail

NODE20=/home/vendetta/.nvm/versions/node/v20.20.2
export PATH="$NODE20/bin:/usr/bin:/bin"
HANORK=/home/vendetta/hanork

rebuild_clean() {
  local label="$1"
  local dir="$2"
  echo "[rebuild-clean] $label"
  cd "$dir"
  rm -rf node_modules/better-sqlite3/build
  JOBS=1 "$NODE20/bin/npm" rebuild better-sqlite3 --build-from-source 2>&1 | tail -20
  "$NODE20/bin/node" -e "const r=require('module').createRequire('$dir/package.json'); r('better-sqlite3')(':memory:'); console.log('probe OK $label')"
}

rebuild_clean hanork "$HANORK"
rebuild_clean zero-divu "$HANORK/zero-divu"

cd "$HANORK"
bash scripts/hanork-ctl.sh start-bg
sleep 90
pgrep -af 'src/bot.js' | head -2
curl -s -m 10 http://127.0.0.1:3000/health/live || echo HEALTH_FAIL
"$NODE20/bin/node" scripts/validate-production.js 2>&1 | tail -12
