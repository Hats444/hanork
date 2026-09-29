#!/usr/bin/env bash
set -euo pipefail
WIN=/mnt/c/Users/boots/Downloads/hanork
HANORK=/home/vendetta/hanork
files=(
  src/telegram/commands/user/userWelcomeTour.js
  src/telegram/menus/mainMenuHandlers.js
  src/utils/broadcastDeepLinks.js
  src/data/hanorkBroadcastVariants.js
  src/data/smmBroadcastVariants.js
  src/config/database-sqlite.js
  src/jobs/registerAllSchedulers.js
  src/jobs/schedulers/pixPendingReminderScheduler.js
  scripts/test-welcome-tour.js
  scripts/test-pix-pending-reminder.js
  docs/audit/PLANO-CONVERSAO-DIVULGACAO.md
)
for f in "${files[@]}"; do
  install -D "$WIN/$f" "$HANORK/$f"
  echo "OK $f"
done
cd "$HANORK"
node scripts/test-welcome-tour.js
node scripts/test-pix-pending-reminder.js
node scripts/test-marketing-md-pick.js
bash scripts/hanork-ctl.sh stop || true
sleep 2
nohup bash scripts/hanork-ctl.sh start >> logs/hanork-ctl.log 2>&1 &
sleep 4
bash scripts/hanork-ctl.sh status
