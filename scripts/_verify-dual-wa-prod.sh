#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:${PATH}"
WSL="/home/vendetta/hanork"
cd "$WSL"

bash scripts/hanork-ctl.sh stop 2>/dev/null || true
sleep 3
pkill -f 'hanork/zero-divu/connect.js' 2>/dev/null || true
sleep 2
bash scripts/hanork-ctl.sh start-bg
sleep 18
node scripts/restore-wa-admin.js || true

echo "--- connect workers ---"
pgrep -af 'hanork/zero-divu/connect' || true

echo "--- dual env (admin workers only) ---"
for p in $(pgrep -f '/home/vendetta/hanork/zero-divu/connect.js' 2>/dev/null); do
  env=$(tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null || true)
  echo "$env" | grep -q 'WA_DIVULGACAO_USER=1' && continue
  sid=$(echo "$env" | grep '^WA_SESSION_ID=' || true)
  dual=$(echo "$env" | grep '^WA_DUAL_JOIN_BIDIRECTIONAL=' || true)
  peer=$(echo "$env" | grep '^WA_DUAL_IPC_DIR_PEER=' || true)
  echo "PID $p | $sid | $dual | $peer"
done

ls -la shared/wa-blast-coord/membership-*.json 2>/dev/null || echo "(membership snapshots ainda não criados — aguardar 10 min ou sync)"
