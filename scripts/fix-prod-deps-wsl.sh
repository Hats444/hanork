#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
cd /home/vendetta/hanork
bash scripts/hanork-ctl.sh stop 2>/dev/null || true
sleep 2
npm install --omit=dev
npm rebuild better-sqlite3
bash scripts/hanork-ctl.sh start-bg
sleep 90
bash scripts/hanork-ctl.sh status
node scripts/validate-production.js || true
node scripts/verify-wadv-v5a.js
