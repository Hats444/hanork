#!/usr/bin/env bash
for p in 30090 30096 $(pgrep -f 'hanork/zero-divu/connect.js' 2>/dev/null); do
  env=$(tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null || true)
  [ -z "$env" ] && continue
  echo "$env" | grep -q 'WA_DIVULGACAO_USER=1' && continue
  echo "=== PID $p ==="
  echo "$env" | grep -E 'WA_SESSION_ID|WA_DUAL_JOIN|WA_DUAL_IPC_DIR_PEER|ZERO_DIVU_IPC_DIR=' | sort
done
echo "bot: $(pgrep -f 'src/bot.js' | head -1)"
