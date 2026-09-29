#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin:/usr/sbin:/sbin"
HANORK=/home/vendetta/hanork
WIN=/mnt/c/Users/boots/Downloads/hanork

/bin/cp -f "$WIN/scripts/ensure-native-sqlite.js" "$HANORK/scripts/ensure-native-sqlite.js"
cd "$HANORK"
node scripts/ensure-native-sqlite.js
