#!/usr/bin/env bash
# Checklist pós-implementação (PLANO-PRODUCAO) — executar no WSL
set -uo pipefail

HANORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HANORK_DIR"
LOG="${HANORK_TERMINAL_LOG:-$HOME/.hanork/terminal.log}"
REPORT="$HANORK_DIR/docs/audit/deploy-checklist-last-run.txt"
mkdir -p "$(dirname "$REPORT")"

pass() { echo "[PASS] $*"; echo "PASS: $*" >> "$REPORT"; }
fail() { echo "[FAIL] $*"; echo "FAIL: $*" >> "$REPORT"; }
skip() { echo "[SKIP] $*"; echo "SKIP: $*" >> "$REPORT"; }
info() { echo "[INFO] $*"; echo "INFO: $*" >> "$REPORT"; }

: > "$REPORT"
echo "=== Hanork deploy checklist $(date -Iseconds) ===" | tee -a "$REPORT"

# 1 — status / restart já feito externamente ou rodar restart
if bash scripts/hanork-ctl.sh status 2>&1 | grep -q 'rodando'; then
  pass "hanork-ctl status — bot rodando"
else
  fail "hanork-ctl status — bot parado"
fi

# 2–4 — métricas
_metrics() {
  curl -sf --max-time 8 "http://127.0.0.1:3000/metrics" 2>/dev/null || true
}
M=$(_metrics)
if [ -z "$M" ]; then
  fail "curl /metrics — sem resposta"
else
  pass "curl /metrics — OK"
  echo "$M" | grep -q 'hanork_boot_duration_seconds' && pass "hanork_boot_duration_seconds presente" || fail "hanork_boot ausente"
  echo "$M" | grep -q 'hanork_smm_sync_age_seconds' && pass "hanork_smm_sync_age_seconds presente" || fail "hanork_smm_sync_age ausente"
  echo "$M" | grep -q 'hanork_stuck_paid_orders' && pass "hanork_stuck_paid_orders presente (P5-3)" || fail "hanork_stuck_paid ausente"
  echo "$M" | grep -q 'hanork_webhook_dedup_redis_total' && pass "hanork_webhook_dedup_redis_total presente (P5-2)" || skip "hanork_webhook_dedup_redis_total (sem tráfego ainda)"
fi

# 5 — Prometheus alerts (obs stack opcional)
if command -v docker >/dev/null 2>&1; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q hanork-prometheus; then
    ALERTS=$(curl -sf --max-time 5 http://127.0.0.1:9090/api/v1/rules 2>/dev/null || true)
    if echo "$ALERTS" | grep -q 'HanorkStuckPaidOrders'; then
      pass "Prometheus — regra HanorkStuckPaidOrders carregada"
    else
      fail "Prometheus — regra HanorkStuckPaidOrders não encontrada"
    fi
  else
    skip "Prometheus container não rodando (npm run obs:up)"
  fi
else
  skip "docker não disponível — obs stack"
fi

# 6 — replay webhook (P5-4 integração)
if node scripts/test-mp-webhook-replay-integration.js >> "$REPORT" 2>&1; then
  pass "Replay webhook MP — P5-4 integração (webhook_dedup_db_hit)"
else
  fail "Replay webhook MP — P5-4 integração"
fi

# 7–8 — manual TG/dashboard
skip "Dashboard XSS malicioso — teste manual no browser"
skip "Admin TG adm_deliver confirmação — teste manual Telegram"

# 9 — P1-4 Ollama
if command -v systemctl >/dev/null 2>&1; then
  OLL=$(systemctl is-active ollama 2>/dev/null | head -1 | tr -d '[:space:]')
  [ -n "$OLL" ] || OLL=unknown
  if [ "$OLL" = "inactive" ] || [ "$OLL" = "failed" ] || [ "$OLL" = "unknown" ]; then
    pass "Ollama systemd: $OLL (P1-4)"
  else
    fail "Ollama systemd: $OLL — rodar: sudo systemctl stop ollama && sudo systemctl disable ollama"
  fi
else
  skip "systemctl não disponível — Ollama"
fi

# 10 — .env flags
ENV_OK=1
grep -q '^USE_LOCAL_AI=false' .env 2>/dev/null && pass ".env USE_LOCAL_AI=false" || { fail ".env USE_LOCAL_AI deve ser false"; ENV_OK=0; }
grep -q '^ZERO_IPC_AUTH_REQUIRED=1' .env 2>/dev/null && pass ".env ZERO_IPC_AUTH_REQUIRED=1" || { fail ".env ZERO_IPC_AUTH_REQUIRED=1"; ENV_OK=0; }
grep -q '^ZERO_IPC_TOKEN=' .env 2>/dev/null && pass ".env ZERO_IPC_TOKEN definido" || fail ".env ZERO_IPC_TOKEN ausente"
grep -q '^DASHBOARD_TENANT_ENFORCE=1' .env 2>/dev/null && pass ".env DASHBOARD_TENANT_ENFORCE=1" || { fail ".env DASHBOARD_TENANT_ENFORCE=1"; ENV_OK=0; }

# 11 — test:unit (subset crítico se full falhar no Windows)
info "Rodando testes críticos de segurança/pagamentos…"
TESTS=(
  scripts/test-dashboard-csrf.js
  scripts/test-dashboard-tenant-scope.js
  scripts/test-webhook-redis-dedup.js
  scripts/test-mp-webhook-handler.js
  scripts/test-mp-webhook-replay-integration.js
  scripts/test-order-metrics.js
  scripts/test-observability-config.js
  scripts/test-prometheus-metrics.js
)
for t in "${TESTS[@]}"; do
  if node "$t" >> "$REPORT" 2>&1; then
    pass "node $t"
  else
    fail "node $t"
  fi
done

# logs tail
if [ -f "$LOG" ]; then
  info "Últimas 15 linhas de $LOG:"
  tail -n 15 "$LOG" | tee -a "$REPORT"
else
  skip "Log $LOG não encontrado"
fi

echo ""
echo "Relatório: $REPORT"
grep -c '^PASS:' "$REPORT" 2>/dev/null | xargs -I{} echo "PASS: {}"
grep -c '^FAIL:' "$REPORT" 2>/dev/null | xargs -I{} echo "FAIL: {}"
grep -c '^SKIP:' "$REPORT" 2>/dev/null | xargs -I{} echo "SKIP: {}"
