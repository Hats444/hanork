#!/usr/bin/env bash
set -euo pipefail

H="${HANORK_DIR:-/home/vendetta/hanork}"
Z="$H/zero-divu"
WH="/mnt/c/Users/boots/Downloads/hanork"
WZ="/mnt/c/Users/boots/Downloads/zero-divu"

cp "$WZ/src/services/customBlast.js" "$Z/src/services/customBlast.js"
cp "$WZ/src/services/statusMessage.js" "$Z/src/services/statusMessage.js"
cp "$WZ/src/ipc/operations.js" "$Z/src/ipc/operations.js"
cp "$WH/src/modules/wa-divulgacao/waDivulgacaoCampaignService.js" "$H/src/modules/wa-divulgacao/waDivulgacaoCampaignService.js"
cp "$WH/scripts/hanork-ctl.sh" "$H/scripts/hanork-ctl.sh"
cp "$WH/scripts/hanork-boot.sh" "$H/scripts/hanork-boot.sh"
chmod +x "$H/scripts/hanork-ctl.sh" "$H/scripts/hanork-boot.sh"

LOG="${HOME}/.hanork/terminal.log"
if [ -f "$LOG" ]; then
  sz=$(stat -c%s "$LOG" 2>/dev/null || echo 0)
  if [ "$sz" -gt 524288000 ]; then
    ts=$(date +%Y%m%d-%H%M%S)
    mv "$LOG" "${LOG%.log}.archive-${ts}.log" 2>/dev/null || true
    : >"$LOG"
    echo "[i] terminal.log rotacionado (${sz} bytes)"
  fi
fi

bash "$H/scripts/hanork-ctl.sh" stop 2>/dev/null || true
sleep 2
bash "$H/scripts/hanork-ctl.sh" start-bg
