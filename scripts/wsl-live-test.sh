#!/usr/bin/env bash
set -euo pipefail
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 25 >/dev/null 2>&1 || true
cd "$(dirname "$0")/.."
echo "NODE=$(node --version)"
rm -f .bot.lock /tmp/hanork-final.log
node src/bot.js > /tmp/hanork-final.log 2>&1 &
BOTPID=$!
echo "STARTED_PID=$BOTPID"
for i in $(seq 1 90); do
  if grep -q 'Polling Telegram ativo' /tmp/hanork-final.log 2>/dev/null; then
    echo "POLLING_OK at $((i * 2))s"
    break
  fi
  if ! kill -0 "$BOTPID" 2>/dev/null; then
    echo "BOT_DIED_EARLY"
    tail -30 /tmp/hanork-final.log
    exit 1
  fi
  sleep 2
done
if ! grep -q 'Polling Telegram ativo' /tmp/hanork-final.log 2>/dev/null; then
  echo "NO_POLLING_YET"
  tail -15 /tmp/hanork-final.log
fi
echo "Running 60s after polling check..."
sleep 60
if kill -0 "$BOTPID" 2>/dev/null; then
  echo "STILL_RUNNING_OK"
  kill "$BOTPID" 2>/dev/null || true
  wait "$BOTPID" 2>/dev/null || true
else
  echo "BOT_EXITED_BEFORE_60s"
  tail -20 /tmp/hanork-final.log
  exit 1
fi
echo "ERROR_LINES=$(grep -ci error /tmp/hanork-final.log || true)"
grep -iE 'fatal|exception' /tmp/hanork-final.log || echo "NO_FATAL"
echo "--- tail ---"
tail -12 /tmp/hanork-final.log
