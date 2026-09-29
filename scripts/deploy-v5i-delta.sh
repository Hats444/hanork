#!/usr/bin/env bash
set -euo pipefail

HANORK="${HANORK_ROOT:-/home/vendetta/hanork}"
WIN="${WIN_HANORK:-/mnt/c/Users/boots/Downloads/hanork}"

echo "[deploy-v5i] copying Always-On Universal v5i delta…"

cp "$WIN/src/plugins/zero-divu/spawnZeroWorker.js" \
   "$WIN/src/plugins/zero-divu/waWorkerEnsureService.js" \
   "$WIN/src/plugins/zero-divu/waIpcHelper.js" \
   "$WIN/src/plugins/zero-divu/promo.js" \
   "$WIN/src/plugins/zero-divu/waPanelUi.js" \
   "$WIN/src/plugins/zero-divu/zeroDivuAdminPanel.js" \
   "$HANORK/src/plugins/zero-divu/"

cp "$WIN/src/modules/wa-divulgacao/waDivulgacaoAlwaysOnService.js" \
   "$WIN/src/modules/wa-divulgacao/waDivulgacaoWorkerService.js" \
   "$WIN/src/modules/wa-divulgacao/waDivulgacaoCopy.js" \
   "$HANORK/src/modules/wa-divulgacao/"

cp "$WIN/src/modules/wa-divulgacao/callbacks/waDivulgacaoHandlers.js" \
   "$HANORK/src/modules/wa-divulgacao/callbacks/"

cp "$WIN/src/modules/wa-divulgacao/handlers/waDivulgacaoUiHandlers.js" \
   "$HANORK/src/modules/wa-divulgacao/handlers/"

cp "$WIN/zero-divu/connect.js" "$HANORK/zero-divu/connect.js"

cd "$HANORK"
bash scripts/hanork-ctl.sh restart

echo "[deploy-v5i] waiting for boot…"
sleep 45

BOT_PID=$(pgrep -f 'node src/bot.js' | head -1 || true)
echo "[deploy-v5i] bot PID: ${BOT_PID:-none}"

bash scripts/node-hanork.sh scripts/validate-production.js
VALIDATE_EXIT=$?

bash scripts/node-hanork.sh scripts/prod-metrics-snapshot.js 2>/dev/null || true

exit "$VALIDATE_EXIT"
