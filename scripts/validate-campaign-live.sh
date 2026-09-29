#!/usr/bin/env bash
# Valida execução de slots do Campaign Orchestrator (rodar após 00:05, 08:05, etc.)
set -euo pipefail
cd "$(dirname "$0")/.."
export CAMPAIGN_ORCHESTRATOR=1

echo "=== Validação live Campaign Orchestrator ==="
date
echo ""

echo "--- Status ---"
node scripts/check-campaign-status.js 2>/dev/null | grep -E 'now_local|orchestrator|window|due_|deliveries|history|queue' || node scripts/check-campaign-status.js 2>&1 | tail -8

echo ""
echo "--- Últimos logs orquestrador ---"
grep -a 'slots devidos\|slot grupo OK\|slot PV OK\|CampaignOrchestrator\|ciclo direcionado' \
  /home/vendetta/.hanork/terminal.log 2>/dev/null | tail -12 || echo "(sem logs)"

echo ""
echo "--- Entregas recentes (DB) ---"
node -e "
const db = require('better-sqlite3')('/home/vendetta/.hanork/hanork.db');
const rows = db.prepare(
  \"SELECT dest_type, dest_id, campaign_type, status, delivered_at FROM campaign_deliveries ORDER BY id DESC LIMIT 6\"
).all();
const hist = db.prepare(
  \"SELECT slot_key, campaign_type, channel, source, finished_at FROM campaign_history ORDER BY id DESC LIMIT 4\"
).all();
console.log('deliveries:', JSON.stringify(rows, null, 2));
console.log('history:', JSON.stringify(hist, null, 2));
" 2>/dev/null || echo "(DB check skipped)"

echo ""
if grep -aq 'slot grupo OK\|slot PV OK' /home/vendetta/.hanork/terminal.log 2>/dev/null; then
  echo "RESULT: SLOT EXECUTADO"
elif grep -aq 'ciclo direcionado' /home/vendetta/.hanork/terminal.log 2>/dev/null \
  && ! grep -aq 'slot grupo OK\|slot PV OK' /home/vendetta/.hanork/terminal.log 2>/dev/null; then
  echo "RESULT: BLOQUEADO — ciclo direcionado sem slot OK (bridge promo travou finalização?)"
else
  echo "RESULT: aguardando slot (normal antes de 00:00 / 08:00 / etc.)"
fi
