#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
cd /home/vendetta/hanork
npm rebuild better-sqlite3 2>/dev/null || true
sleep 20
node scripts/validate-production.js || true
node scripts/verify-wadv-v5a.js
grep -iE 'always-on|WaDivulgacao' /home/vendetta/.hanork/terminal.log 2>/dev/null | tail -8
