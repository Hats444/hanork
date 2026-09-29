#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:${PATH}"
cd /home/vendetta/hanork

# Mata workers admin sem dual join env (legado)
for p in $(pgrep -f 'hanork/zero-divu/connect.js' 2>/dev/null || true); do
  env=$(tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null || true)
  echo "$env" | grep -q 'WA_DIVULGACAO_USER=1' && continue
  if echo "$env" | grep -qE 'WA_SESSION_ID=wa_[ab]'; then
    if ! echo "$env" | grep -q 'WA_DUAL_JOIN_BIDIRECTIONAL=1'; then
      echo "[*] kill stale admin worker PID $p (sem dual join env)"
      kill "$p" 2>/dev/null || true
    fi
  fi
done

sleep 2
bash scripts/hanork-ctl.sh stop 2>/dev/null || true
sleep 2
pkill -f 'hanork/zero-divu/connect.js' 2>/dev/null || true
sleep 2
bash scripts/hanork-ctl.sh start-bg
sleep 20
node scripts/restore-wa-admin.js || true

echo "--- admin workers ---"
for p in $(pgrep -f 'hanork/zero-divu/connect.js' 2>/dev/null || true); do
  env=$(tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null || true)
  echo "$env" | grep -q 'WA_DIVULGACAO_USER=1' && continue
  echo "$env" | grep -qE 'WA_SESSION_ID=wa_[ab]' || continue
  sid=$(echo "$env" | grep '^WA_SESSION_ID=')
  dual=$(echo "$env" | grep '^WA_DUAL_JOIN_BIDIRECTIONAL=' || echo 'MISSING_DUAL')
  peer=$(echo "$env" | grep '^WA_DUAL_IPC_DIR_PEER=' || echo 'MISSING_PEER')
  echo "PID $p | $sid | $dual | $peer"
done
