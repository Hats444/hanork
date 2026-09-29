#!/usr/bin/env bash
LOG="${HANORK_TERMINAL_LOG:-$HOME/.hanork/terminal.log}"
IPC="/home/vendetta/.hanork/wa-users/7078046700/ipc"
echo "Monitor QR — $(date -Iseconds) — clique QR Code no bot"
LAST_LINE=$(wc -l < "$LOG" 2>/dev/null || echo 0)
for i in $(seq 1 36); do
  sleep 5
  CUR=$(wc -l < "$LOG" 2>/dev/null || echo 0)
  if [ "$CUR" -gt "$LAST_LINE" ]; then
    tail -n $((CUR - LAST_LINE)) "$LOG" 2>/dev/null | grep -aE '7078046700|qr boot start|start_login|connect:qr|wa\.qr|Worker pronto.*qr|start_login IPC|Primeiro login' || true
    LAST_LINE=$CUR
  fi
  SL=$(grep -c 'start_login' "$IPC/commands.jsonl" 2>/dev/null || echo 0)
  QL=$(grep -c '"type":"wa.qr"' "$IPC/events.jsonl" 2>/dev/null || echo 0)
  echo "[$(date +%H:%M:%S)] tick $i — start_login cmds: $SL | wa.qr events: $QL"
done
echo "--- fim monitor 3min ---"
