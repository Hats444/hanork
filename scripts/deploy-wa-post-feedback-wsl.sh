#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:${PATH}"

WIN="/mnt/c/Users/boots/Downloads/hanork"
WSL="/home/vendetta/hanork"

echo "[1] sync plugins zero-divu"
rsync -a "$WIN/src/plugins/zero-divu/" "$WSL/src/plugins/zero-divu/"

echo "[2] sync zero-divu worker"
rsync -a \
  --exclude node_modules \
  --exclude database/session \
  "$WIN/zero-divu/" "$WSL/zero-divu/"

echo "[3] restart bot"
bash "$WSL/scripts/hanork-ctl.sh" stop 2>/dev/null || true
sleep 2
bash "$WSL/scripts/hanork-ctl.sh" start-bg
sleep 12

echo "[4] verify"
test -f "$WSL/zero-divu/src/utils/postEligibility.js"
test -f "$WSL/src/plugins/zero-divu/waPostFeedback.js"
bash "$WSL/scripts/hanork-ctl.sh" status | head -12

echo "[OK] deploy wa post feedback"
