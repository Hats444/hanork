#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
HANORK="/home/vendetta/hanork"
WIN="/mnt/c/Users/boots/Downloads/hanork"
rsync -a --delete "$WIN/src/" "$HANORK/src/"
cp "$WIN/docs/HANORK-STATUS.md" "$HANORK/docs/HANORK-STATUS.md"
cp "$WIN/docs/audit/PLANO-CONVERSAO-DIVULGACAO.md" "$HANORK/docs/audit/PLANO-CONVERSAO-DIVULGACAO.md" 2>/dev/null || true
cd "$HANORK"
bash scripts/hanork-ctl.sh stop
sleep 2
bash scripts/hanork-ctl.sh start-bg
sleep 18
bash scripts/hanork-ctl.sh status
