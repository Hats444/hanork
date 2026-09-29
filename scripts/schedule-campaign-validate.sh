#!/usr/bin/env bash
# Aguarda 00:06 BRT e roda validate-campaign-live.sh (P8-4)
set -euo pipefail
REPORT="/home/vendetta/.hanork/campaign-validate-scheduled.log"
WORKER="$(dirname "$0")/schedule-campaign-validate-worker.sh"

if [ "${1:-}" = "--now" ]; then
  cd "$(dirname "$0")/.."
  exec bash scripts/validate-campaign-live.sh
fi

nohup bash "$WORKER" >/dev/null 2>&1 &
echo "PID $! — validação agendada para 00:06 BRT"
echo "Log: $REPORT"
echo "Monitor: tail -f $REPORT"
