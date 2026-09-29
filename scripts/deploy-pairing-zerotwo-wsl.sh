#!/usr/bin/env bash
set -euo pipefail
HANORK="${HANORK_ROOT:-/home/vendetta/hanork}"
WIN="${WIN_HANORK:-/mnt/c/Users/boots/Downloads/hanork}"

echo "[deploy-pairing-zerotwo] sync connect.js + docs…"
cp "$WIN/zero-divu/connect.js" "$HANORK/zero-divu/connect.js"
sed -i 's/\r$//' "$HANORK/zero-divu/connect.js"
node --check "$HANORK/zero-divu/connect.js"
cp "$WIN/docs/HANORK-STATUS.md" "$HANORK/docs/HANORK-STATUS.md"
cp "$WIN/docs/audit/PLANO-CONVERSAO-DIVULGACAO.md" "$HANORK/docs/audit/PLANO-CONVERSAO-DIVULGACAO.md"

cd "$HANORK"
bash scripts/hanork-ctl.sh restart

echo "[deploy-pairing-zerotwo] waiting boot…"
sleep 35

BOT_PID=$(pgrep -f 'node src/bot.js' | head -1 || true)
echo "[deploy-pairing-zerotwo] bot PID: ${BOT_PID:-none}"

bash scripts/node-hanork.sh scripts/validate-production.js
VALIDATE_EXIT=$?

bash scripts/node-hanork.sh scripts/prod-metrics-snapshot.js 2>/dev/null || true

exit "$VALIDATE_EXIT"
