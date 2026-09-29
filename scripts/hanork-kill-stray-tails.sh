#!/usr/bin/env bash
# Mata processos tail -F duplicados no terminal.log (causa scroll louco).
set -euo pipefail
LOG="${HANORK_TERMINAL_LOG:-$HOME/.hanork/terminal.log}"
count=0
while IFS= read -r line; do
  pid=$(echo "$line" | awk '{print $1}')
  [ -n "$pid" ] || continue
  echo "[*] Encerrando tail PID $pid"
  kill -TERM "$pid" 2>/dev/null || true
  count=$((count + 1))
done < <(pgrep -af "tail.*${LOG}" 2>/dev/null || true)
sleep 1
# SIGKILL se ainda vivo
while IFS= read -r line; do
  pid=$(echo "$line" | awk '{print $1}')
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
done < <(pgrep -af "tail.*${LOG}" 2>/dev/null || true)
echo "[✓] ${count} processo(s) tail removido(s). Use: tail -F ${LOG} (só UM terminal)"
