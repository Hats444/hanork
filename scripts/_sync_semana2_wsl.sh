#!/usr/bin/env bash
set -euo pipefail
WIN=/mnt/c/Users/boots/Downloads/hanork
HANORK=/home/vendetta/hanork
files=(
  src/data/marketingWeekdayCalendar.js
  src/data/marketingMarkdownVariants.js
  src/services/SalesReferenceChannelService.js
  src/jobs/schedulers/salesRefDailyPromoScheduler.js
  src/jobs/registerAllSchedulers.js
  scripts/test-marketing-weekday-calendar.js
  docs/audit/PLANO-CONVERSAO-DIVULGACAO.md
  .env.example
)
for f in "${files[@]}"; do
  install -D "$WIN/$f" "$HANORK/$f"
  echo "OK $f"
done
cd "$HANORK"
node scripts/test-marketing-weekday-calendar.js
node scripts/test-marketing-md-pick.js
bash scripts/hanork-ctl.sh stop || true
sleep 2
nohup bash scripts/hanork-ctl.sh start >> logs/hanork-ctl.log 2>&1 &
sleep 4
bash scripts/hanork-ctl.sh status
grep -q '^MARKETING_WEEKDAY_CALENDAR=' "$HANORK/.env" 2>/dev/null || echo 'MARKETING_WEEKDAY_CALENDAR=1' >> "$HANORK/.env"
grep -q '^SALES_REF_DAILY_PROMO=' "$HANORK/.env" 2>/dev/null || echo 'SALES_REF_DAILY_PROMO=1' >> "$HANORK/.env"
