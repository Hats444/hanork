#!/usr/bin/env bash
# Sincroniza correção SALES_REF Virtuo (só após SMS) para /home/vendetta/hanork
set -euo pipefail

SRC="${HANORK_SRC:-/mnt/c/Users/boots/Downloads/hanork}"
DST="${HANORK_DST:-/home/vendetta/hanork}"

FILES=(
  src/services/salesReferenceReadiness.js
  src/services/SalesReferenceChannelService.js
  src/jobs/eventHandlers/salesReferenceChannel.js
  src/modules/virtuo/services/fulfillmentService.js
  src/modules/virtuo/jobs/activationMonitorJob.js
  src/modules/virtuo/helpers/virtuoUserNotify.js
)

for f in "${FILES[@]}"; do
  if [ ! -f "$SRC/$f" ]; then
    echo "[!] ausente no source: $f"
    exit 1
  fi
  cp "$SRC/$f" "$DST/$f"
  sed -i 's/\r$//' "$DST/$f"
  sed -i '1s/^\xEF\xBB\xBF//' "$DST/$f"
  echo "[✓] $f"
done

node --check "$DST/src/services/salesReferenceReadiness.js"
node --check "$DST/src/modules/virtuo/services/fulfillmentService.js"
echo ""
echo "[✓] Sintaxe OK — reinicie no SEU Ubuntu:"
echo "    cd $DST && bash scripts/hanork-ctl.sh restart"
