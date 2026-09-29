#!/usr/bin/env bash
# P5-4 — Valida critério P0-2 (dedup DB em replay de webhook MP).
# Uso:
#   bash scripts/replay-mp-webhook-staging.sh          # teste integração offline (padrão)
#   LIVE_LOG_CHECK=1 bash scripts/replay-mp-webhook-staging.sh  # + grep logs produção
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== P5-4 Replay webhook MP (staging) ==="
node scripts/test-mp-webhook-replay-integration.js

if [ "${LIVE_LOG_CHECK:-0}" = "1" ]; then
  LOG="${HANORK_LOG:-$HOME/.hanork/terminal.log}"
  if [ -f "$LOG" ]; then
    echo ""
    echo "--- Últimos webhook_dedup_db_hit em $LOG ---"
    grep -a 'webhook_dedup_db_hit' "$LOG" 2>/dev/null | tail -5 || echo "(nenhum — normal se não houve replay real ainda)"
  else
    echo "SKIP: log $LOG não encontrado"
  fi
fi

echo ""
echo "RESULT: P5-4 integração OK"
