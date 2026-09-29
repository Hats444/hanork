#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
PROD="/home/vendetta/hanork"
cd "$PROD"

npm rebuild better-sqlite3 2>/dev/null || true
bash scripts/hanork-ctl.sh start-bg

echo "[*] Aguardando boot (até 180s)..."
for i in $(seq 1 36); do
  if curl -sf http://127.0.0.1:3000/health/live >/dev/null 2>&1; then
    echo "[OK] health/live em ${i}0s"
    break
  fi
  sleep 5
done

bash scripts/hanork-ctl.sh status
node scripts/validate-production.js || true
node scripts/verify-wadv-v5a.js
