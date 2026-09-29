#!/usr/bin/env bash
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:${PATH}"
cd /home/vendetta/hanork
echo "NODE=$(node -v)"
ls -la node_modules/better-sqlite3/package.json 2>&1 || echo "NO_PKG"
ls node_modules/better-sqlite3/build/Release/*.node 2>&1 || echo "NO_NODE"
node scripts/ensure-native-sqlite.js 2>&1 | tail -15
node -e 'require("better-sqlite3")(":memory:"); console.log("SQLITE_OK")' 2>&1
