#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin:/usr/sbin:/sbin"
HANORK=/home/vendetta/hanork
cd "$HANORK"

echo "=== build tools ==="
command -v make && command -v gcc && command -v python3

echo "=== clean hanork better-sqlite3 ==="
rm -rf node_modules/better-sqlite3/build node_modules/better-sqlite3/prebuilds
cd "$HANORK"
npm rebuild better-sqlite3 2>&1 | tail -15
ls -la node_modules/better-sqlite3/build/Release/better_sqlite3.node

echo "=== clean zero-divu better-sqlite3 ==="
rm -rf zero-divu/node_modules/better-sqlite3/build zero-divu/node_modules/better-sqlite3/prebuilds
cd "$HANORK/zero-divu"
npm rebuild better-sqlite3 2>&1 | tail -15
ls -la node_modules/better-sqlite3/build/Release/better_sqlite3.node

echo "=== probe both ==="
cd "$HANORK"
node -e 'require("better-sqlite3")(":memory:"); console.log("hanork OK")'
node -e 'process.chdir("zero-divu"); require("better-sqlite3")(":memory:"); console.log("zero-divu OK")'
