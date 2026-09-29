#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
cd /home/vendetta/hanork

npm rebuild better-sqlite3 2>&1 | tail -2
node -e "require('better-sqlite3'); console.log('sqlite ok')"

./scripts/hanork-ctl.sh status

sleep 25
if curl -sf http://127.0.0.1:3000/health/live >/dev/null; then
  echo "HEALTH_LIVE_OK"
else
  echo "HEALTH_LIVE_PENDING"
fi

grep -E 'Polling Telegram|BOOT-FATAL|WaDivulgacao.*ativo' /home/vendetta/.hanork/terminal.log | tail -6

node scripts/verify-wadv-v5a.js 2>&1 | tail -3
