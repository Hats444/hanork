#!/usr/bin/env bash
set -uo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
cd /home/vendetta/hanork

echo "=== hanork-ctl status ==="
bash scripts/hanork-ctl.sh status || true

echo "=== processes ==="
pgrep -af bot.js || echo "no bot.js"
pgrep -af connect.js || echo "no connect.js"

echo "=== tail terminal.log ==="
tail -50 /home/vendetta/.hanork/terminal.log 2>/dev/null || true

echo "=== rebuild sqlite node20 ==="
rm -rf node_modules/better-sqlite3/build
/home/vendetta/.nvm/versions/node/v20.20.2/bin/npm rebuild better-sqlite3

echo "=== rebuild sqlite node25 ==="
/home/vendetta/.nvm/versions/node/v25.2.1/bin/npm rebuild better-sqlite3

echo "=== start if down ==="
if ! pgrep -f 'node src/bot.js' >/dev/null; then
  bash scripts/hanork-ctl.sh start-bg
  sleep 45
fi

bash scripts/hanork-ctl.sh status || true
pgrep -af bot.js || true
pgrep -af connect.js || true

node scripts/restore-wa-admin.js 2>&1 || true
sleep 8
pgrep -af connect.js || true

/home/vendetta/.nvm/versions/node/v20.20.2/bin/node scripts/validate-production.js
