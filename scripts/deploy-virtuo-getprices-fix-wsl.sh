#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
DL="/mnt/c/Users/boots/Downloads/hanork"
PROD="/home/vendetta/hanork"

echo "[1] sync virtuo module + safeTelegram + wadv login fixes"
rsync -a "$DL/src/modules/virtuo/" "$PROD/src/modules/virtuo/"
rsync -a "$DL/src/utils/safeTelegram.js" "$PROD/src/utils/"
rsync -a "$DL/src/modules/wa-divulgacao/" "$PROD/src/modules/wa-divulgacao/"
rsync -a "$DL/zero-divu/src/services/divBlast.js" "$PROD/zero-divu/src/services/divBlast.js"
rsync -a "$DL/src/services/WalletPaymentService.js" "$PROD/src/services/"

echo "[2] syntax check"
node --check "$PROD/src/modules/virtuo/providers/virtuoApiClient.js"
node --check "$PROD/src/modules/virtuo/services/virtuoStockService.js"
node --check "$PROD/src/modules/wa-divulgacao/waDivulgacaoCampaignService.js"
node --check "$PROD/src/services/WalletPaymentService.js"
grep -c 'fetchPricesList' "$PROD/src/modules/virtuo/providers/virtuoApiClient.js"
grep -c 'activation exception' "$PROD/src/modules/virtuo/services/fulfillmentService.js"

echo "[3] restart"
cd "$PROD"
bash scripts/hanork-ctl.sh restart-bg
sleep 14
bash scripts/hanork-ctl.sh status

echo "[4] reschedule stuck virtuo orders"
NODE=/home/vendetta/.nvm/versions/node/v20.20.2/bin/node
$NODE scripts/reschedule-virtuo-orders.js \
  2dcf837b-6b48-4cf6-8bc5-f89bd4bd6166 \
  7bece2e0-2b0d-4e7d-9f27-dafa00aea680 || true

echo "DEPLOY_VIRTUO_GETPRICES_OK PID=$(cat /home/vendetta/.hanork/bot.pid 2>/dev/null || echo unknown)"
