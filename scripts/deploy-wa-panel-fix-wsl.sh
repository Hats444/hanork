#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:${PATH}"

WIN="/mnt/c/Users/boots/Downloads/hanork"
WSL="/home/vendetta/hanork"

echo "[1] sync plugins zero-divu"
rsync -a "$WIN/src/plugins/zero-divu/" "$WSL/src/plugins/zero-divu/"

echo "[2] sync zero-divu worker (services + ipc)"
rsync -a "$WIN/zero-divu/src/services/" "$WSL/zero-divu/src/services/"
rsync -a "$WIN/zero-divu/src/ipc/" "$WSL/zero-divu/src/ipc/"

echo "[3] sync wa-divulgacao handlers"
rsync -a "$WIN/src/modules/wa-divulgacao/handlers/" "$WSL/src/modules/wa-divulgacao/handlers/"

echo "[4] verify handlers wired"
grep -q registerAdminOpsHandlers "$WSL/src/plugins/zero-divu/index.js"
grep -q registerWaCustomBlast "$WSL/src/plugins/zero-divu/index.js"

echo "[5] restart bot"
bash "$WSL/scripts/hanork-ctl.sh" stop 2>/dev/null || true
sleep 2
bash "$WSL/scripts/hanork-ctl.sh" start-bg
sleep 12

echo "[6] restart zero-divu workers"
bash "$WSL/scripts/hanork-ctl.sh" wa-restart 2>/dev/null || bash "$WSL/scripts/node-hanork.sh" wa-restart 2>/dev/null || true

echo "[7] verify"
test -f "$WSL/src/plugins/zero-divu/waIpcHelper.js"
grep -q safeEditAdminPanel "$WSL/src/plugins/zero-divu/waIpcHelper.js"
bash "$WSL/scripts/hanork-ctl.sh" status | head -12

echo "[OK] deploy wa panel fix (cache-first + timeouts)"
