#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:$PATH"
cd /home/vendetta/hanork
rm -f .bot.lock .hanork-start.lock .start.lock
pkill -9 -f 'hanork-ctl.sh start' 2>/dev/null || true
pkill -9 -f 'hanork-boot.sh' 2>/dev/null || true
if pgrep -f 'src/bot.js' >/dev/null 2>&1; then
  echo "ALREADY_RUNNING $(pgrep -f 'src/bot.js' | head -1)"
  exit 0
fi
nohup node src/bot.js >> "${HOME}/.hanork/terminal.log" 2>&1 &
echo "$!" > .bot.lock
sleep 6
if kill -0 "$(cat .bot.lock)" 2>/dev/null; then
  echo "STARTED PID $(cat .bot.lock)"
else
  echo "FAILED"
  tail -15 "${HOME}/.hanork/terminal.log"
  exit 1
fi
