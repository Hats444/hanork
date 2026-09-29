#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
DL="/mnt/c/Users/boots/Downloads/hanork"
PROD="/home/vendetta/hanork"

echo "[1] sync wa-divulgacao"
rsync -a "$DL/src/modules/wa-divulgacao/" "$PROD/src/modules/wa-divulgacao/"

echo "[1b] sync zero-divu blast utils"
rsync -a "$DL/zero-divu/src/utils/personalizeGroupText.js" "$PROD/zero-divu/src/utils/"
rsync -a "$DL/zero-divu/src/services/divBlast.js" "$PROD/zero-divu/src/services/"

echo "[1c] sync virtuo getPrices fix"
rsync -a "$DL/src/modules/virtuo/providers/virtuoApiClient.js" "$PROD/src/modules/virtuo/providers/"

echo "[2] sync docs"
cp "$DL/docs/HANORK-STATUS.md" "$PROD/docs/HANORK-STATUS.md"
cp "$DL/docs/audit/PLANO-CONVERSAO-DIVULGACAO.md" "$PROD/docs/audit/" 2>/dev/null || true
mkdir -p /home/vendetta/hanork/docs/audit
cp "$DL/docs/HANORK-STATUS.md" /home/vendetta/hanork/docs/audit/ 2>/dev/null || true

echo "[3] markers"
grep -c 'campWizardNavKeyboard' "$PROD/src/modules/wa-divulgacao/keyboards/waDivulgacaoKeyboards.js"
grep -c '_pruneLoginMemory' "$PROD/src/modules/wa-divulgacao/waDivulgacaoLoginService.js"
grep -c 'formatPanelErrorMessage' "$PROD/src/modules/wa-divulgacao/waDivulgacaoCopy.js"

echo "[4] restart"
cd "$PROD"
bash scripts/hanork-ctl.sh restart-bg
sleep 12
bash scripts/hanork-ctl.sh status

echo "[5] verify wadv"
node scripts/verify-wadv-v5a.js || true

echo "DEPLOY_WADV_DIVUG_P2_OK PID=$(cat /home/vendetta/.hanork/bot.pid 2>/dev/null || echo unknown)"
