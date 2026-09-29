#!/usr/bin/env bash
set -euo pipefail
SRC=/mnt/c/Users/boots/Downloads/hanork
DST=/home/vendetta/hanork
files=(
  src/modules/payment/mpWebhookHandler.js
  src/modules/payment/webhookPaymentDedup.js
  src/modules/payment/webhookRedisDedup.js
  src/modules/payment/mpWebhookSecurity.js
  src/app/createServer.js
  src/jobs/startupRecovery.js
)
for f in "${files[@]}"; do
  install -D -m 644 "$SRC/$f" "$DST/$f"
  echo "OK $f"
done
cd "$DST"
echo "createServer handleMpWebhook refs: $(grep -c handleMpWebhook src/app/createServer.js || true)"
node scripts/test-mp-webhook-replay-integration.js
echo "--- restart ---"
bash scripts/hanork-ctl.sh restart
