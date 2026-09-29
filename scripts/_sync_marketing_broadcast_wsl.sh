#!/usr/bin/env bash
set -euo pipefail
HANORK=/home/vendetta/hanork
WIN=/mnt/c/Users/boots/Downloads/hanork

files=(
  src/data/marketingMarkdownVariants.js
  src/data/hanorkBroadcastVariants.js
  src/data/smmBroadcastVariants.js
  scripts/test-marketing-md-pick.js
  .env.example
)
for f in "${files[@]}"; do
  install -D "$WIN/$f" "$HANORK/$f"
  echo "OK $f"
done

rsync -a --delete "$WIN/marketing/" "$HANORK/marketing/"
echo "OK marketing/ (hanork + smm)"

if ! grep -q '^BROADCAST_MARKETING_MD=' "$HANORK/.env" 2>/dev/null; then
  echo 'BROADCAST_MARKETING_MD=1' >> "$HANORK/.env"
  echo "OK .env +BROADCAST_MARKETING_MD=1"
else
  echo "OK .env already has BROADCAST_MARKETING_MD"
fi

cd "$HANORK"
node scripts/test-marketing-md-pick.js

bash "$HANORK/scripts/hanork-ctl.sh" stop || true
sleep 2
nohup bash "$HANORK/scripts/hanork-ctl.sh" start >> "$HANORK/logs/hanork-ctl.log" 2>&1 &
echo "OK bot restarted (nohup)"
