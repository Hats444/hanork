#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
cd /home/vendetta/hanork

echo "node=$(node -v)"
echo "cwd=$(pwd)"

if node -e "require('better-sqlite3')(':memory:'); console.log('sqlite OK')"; then
  exit 0
fi

echo "--- npm rebuild better-sqlite3 ---"
npm rebuild better-sqlite3 2>&1 || true

node -e "require('better-sqlite3')(':memory:'); console.log('sqlite OK after rebuild')"
