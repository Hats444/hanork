#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin:/usr/sbin:/sbin"
HANORK=/home/vendetta/hanork
TMP=/tmp/hanork-sqlite-build-$$
mkdir -p "$TMP"
cd "$TMP"

build_for() {
  local label="$1"
  local dest="$2"
  echo "=== build $label ==="
  rm -rf "$TMP/pkg"
  mkdir -p "$TMP/pkg"
  cd "$TMP/pkg"
  npm pack "better-sqlite3@12.11.1" >/dev/null
  tar -xzf better-sqlite3-*.tgz
  cd package
  npm run build-release 2>&1 | tail -8
  test -f build/Release/better_sqlite3.node
  mkdir -p "$dest/node_modules/better-sqlite3/build/Release"
  /bin/cp -f build/Release/better_sqlite3.node "$dest/node_modules/better-sqlite3/build/Release/"
  node -e "process.chdir('$dest'); require('better-sqlite3')(':memory:'); console.log('$label OK')"
}

# ensure package skeleton exists
if [ ! -f "$HANORK/node_modules/better-sqlite3/package.json" ]; then
  mkdir -p "$HANORK/node_modules/better-sqlite3"
  cd "$TMP"
  npm pack "better-sqlite3@12.11.1" >/dev/null
  tar -xzf better-sqlite3-*.tgz -C "$HANORK/node_modules/better-sqlite3" --strip-components=1
fi

build_for hanork "$HANORK"

if [ -f "$HANORK/zero-divu/node_modules/better-sqlite3/package.json" ]; then
  build_for zero-divu "$HANORK/zero-divu"
fi

/bin/cp -f /mnt/c/Users/boots/Downloads/hanork/scripts/ensure-native-sqlite.js "$HANORK/scripts/ensure-native-sqlite.js"
cd "$HANORK"
node scripts/ensure-native-sqlite.js

rm -rf "$TMP"
echo "=== sqlite rebuild done ==="
