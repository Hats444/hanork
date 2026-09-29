#!/usr/bin/env bash
export PATH="/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
cd /home/vendetta/hanork
echo "node=$(which node) $(node -v)"
node -e "require('better-sqlite3')(':memory:'); console.log('direct sqlite OK')" 2>&1 || true
ls -la node_modules/better-sqlite3/build/Release/ 2>&1 || true
bash scripts/hanork-ctl.sh status
tail -30 /home/vendetta/.hanork/terminal.log 2>/dev/null | tr -d '\r'
