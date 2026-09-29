#!/usr/bin/env bash
set -euo pipefail
HANORK=/home/vendetta/hanork
cp /mnt/c/Users/boots/Downloads/hanork/scripts/retry-smm-fulfill.js "$HANORK/scripts/retry-smm-fulfill.js"
cd "$HANORK"
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
node scripts/retry-smm-fulfill.js "$@"
