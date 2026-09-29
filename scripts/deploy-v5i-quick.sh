#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
DL="/mnt/c/Users/boots/Downloads/hanork"
PROD="/home/vendetta/hanork"

echo "[1] wa-divulgacao"
rsync -a "$DL/src/modules/wa-divulgacao/" "$PROD/src/modules/wa-divulgacao/"

echo "[2] zero-divu plugins"
rsync -a "$DL/src/plugins/zero-divu/" "$PROD/src/plugins/zero-divu/"

echo "[3] zero-divu worker"
rsync -a --exclude node_modules --exclude database/session "$DL/zero-divu/" "$PROD/zero-divu/"

echo "[4] docs"
mkdir -p "$PROD/docs"
cp "$DL/docs/HANORK-STATUS.md" "$PROD/docs/HANORK-STATUS.md"

echo "[5] restart"
pkill -f 'src/bot\.js' 2>/dev/null || true
sleep 2
cd "$PROD"
bash scripts/hanork-ctl.sh start-bg
sleep 8
bash scripts/hanork-ctl.sh status

echo "[6] validate"
node scripts/validate-production.js
node scripts/verify-wadv-v5a.js

echo DONE
