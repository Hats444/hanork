#!/usr/bin/env bash
set -euo pipefail
cd /home/vendetta/hanork
REPORT="/home/vendetta/.hanork/campaign-validate-scheduled.log"
{
  echo "=== P8-4 scheduled validation ==="
  echo "started: $(date)"
  now_epoch=$(date +%s)
  target_date=$(date -d "today 0:06" +%s)
  if [ "$target_date" -le "$now_epoch" ]; then
    target_date=$(date -d "tomorrow 0:06" +%s)
  fi
  wait_sec=$((target_date - now_epoch))
  echo "wait_sec: $wait_sec (target 00:06 BRT)"
  sleep "$wait_sec"
  echo "running at: $(date)"
  bash scripts/validate-campaign-live.sh
  echo "done: $(date)"
} >> "$REPORT" 2>&1
