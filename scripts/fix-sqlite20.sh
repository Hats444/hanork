#!/usr/bin/env bash
set -x
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:${PATH}"
cd /home/vendetta/hanork/node_modules/better-sqlite3
node -v
npm run build-release 2>&1 || npx node-gyp rebuild --release 2>&1
ls -la build/Release/ 2>&1
node -e "require('better-sqlite3')(':memory:'); console.log('OK')" 2>&1
