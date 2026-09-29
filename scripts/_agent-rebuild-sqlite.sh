#!/usr/bin/env bash
set -euo pipefail
export PATH=/home/vendetta/.nvm/versions/node/v20.20.2/bin:$PATH
VER=$(node -p "require('/home/vendetta/hanork/node_modules/better-sqlite3/package.json').version")
WORKDIR=/tmp/hanork-bsqlite-build-$$
mkdir -p "$WORKDIR"
cd "$WORKDIR"
npm init -y >/dev/null 2>&1
npm install "better-sqlite3@${VER}" 2>&1 | tail -8
cp -f node_modules/better-sqlite3/build/Release/better_sqlite3.node /home/vendetta/hanork/node_modules/better-sqlite3/build/Release/better_sqlite3.node
cd /home/vendetta/hanork
node -e "require('better-sqlite3')(':memory:'); console.log('OK')"
rm -rf "$WORKDIR"