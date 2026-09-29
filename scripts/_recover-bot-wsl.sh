#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:${PATH}"
cd /home/vendetta/hanork

echo "[1] copy better-sqlite3 from zero-divu (already built for v20)"
SRC=zero-divu/node_modules/better-sqlite3
DST=node_modules/better-sqlite3
rm -rf "$DST"
mkdir -p node_modules
cp -a "$SRC" "$DST"
node -e 'require("better-sqlite3")(":memory:"); console.log("SQLITE_OK")'

echo "[2] start bot"
bash scripts/hanork-ctl.sh start-bg
sleep 50
bash scripts/hanork-ctl.sh status
tail -8 /home/vendetta/.hanork/terminal.log | grep -E 'Polling|BOOT-FATAL|error' || tail -5 /home/vendetta/.hanork/terminal.log
curl -sf http://127.0.0.1:3000/health/live && echo " HEALTH_OK" || echo " HEALTH_FAIL"

echo "[3] verify wadv deploy"
grep -c campWizardNavKeyboard src/modules/wa-divulgacao/keyboards/waDivulgacaoKeyboards.js
grep -c _pruneLoginMemory src/modules/wa-divulgacao/waDivulgacaoLoginService.js
