#!/usr/bin/env bash
set -euo pipefail

NODE20=/home/vendetta/.nvm/versions/node/v20.20.2/bin
HANORK=/home/vendetta/hanork
DST="$HANORK/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
mkdir -p "$(dirname "$DST")"

CANDIDATES=(
  "$HANORK/better-sqlite3-build-linux/Release/better_sqlite3.node"
  "$HANORK/hanork/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
  "$HANORK/hanork-novo/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
  "$HANORK/zero-divu/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
)

probe_node() {
  local f="$1"
  "$NODE20/node" -e "
    const path='$f';
    try { require(path); process.exit(0); } catch(e) { process.exit(1); }
  " 2>/dev/null
}

FOUND=""
for src in "${CANDIDATES[@]}"; do
  if [ ! -f "$src" ]; then continue; fi
  cp "$src" "$DST"
  if "$NODE20/node" -e "require('better-sqlite3')(':memory:'); console.log('OK')" 2>/dev/null; then
    echo "[copy] OK from $src"
    FOUND=1
    break
  fi
  echo "[copy] skip (wrong ABI): $src"
done

if [ -z "$FOUND" ]; then
  echo "[copy] FATAL: no v20-compatible better_sqlite3.node found"
  exit 1
fi

cd "$HANORK"
bash scripts/hanork-ctl.sh start-bg
echo "waiting 90s…"
sleep 90

BOT_PID=$(pgrep -f 'node src/bot.js' | head -1 || true)
echo "bot PID: ${BOT_PID:-none}"
HEALTH=$(curl -s -m 10 http://127.0.0.1:3000/health/live || echo FAIL)
echo "health: $HEALTH"
pgrep -af 'hanork/zero-divu/connect.js' | head -5 || true

"$NODE20/node" scripts/validate-production.js 2>&1 | tail -12
