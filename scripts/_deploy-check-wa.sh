#!/bin/bash
for p in $(pgrep -f zero-divu/connect.js); do
  echo "=== PID $p ==="
  tr '\0' '\n' < /proc/$p/environ | grep -E 'ZERO_DIVU|WA_SESSION'
done
cd /home/vendetta/hanork
export PATH=/home/vendetta/.nvm/versions/node/v20.20.2/bin:$PATH
node scripts/test-wa-live-ipc.js 2>&1 | head -50
