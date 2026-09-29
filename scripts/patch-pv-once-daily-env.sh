#!/usr/bin/env bash
set -euo pipefail
ENV="${1:-/home/vendetta/hanork/.env}"
patch() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV"
  else
    echo "${key}=${val}" >> "$ENV"
  fi
}
patch CAMPAIGN_PV_MAX_PER_DAY 1
patch CAMPAIGN_PV_SLOTS '[{"hour":10,"type":"hanork"}]'
patch BROADCAST_MAX_PER_DESTINATION 1
patch BROADCAST_RATE_WINDOW_MS 86400000
patch BROADCAST_PV_ONCE_DAILY 1
patch AUTO_BROADCAST_PV_CYCLE_MS 86400000
patch BROADCAST_MIN_PROMO_GAP_MS 3600000
grep -E 'CAMPAIGN_PV|BROADCAST_MAX|BROADCAST_RATE|BROADCAST_PV_ONCE|AUTO_BROADCAST_PV|BROADCAST_MIN_PROMO' "$ENV"
