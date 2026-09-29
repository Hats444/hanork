#!/bin/bash
# Remove .bot.lock órfão (PID morto ou arquivo inválido)
set -euo pipefail

BOT_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
LOCK="$BOT_DIR/.bot.lock"

if [ ! -f "$LOCK" ]; then
  exit 0
fi

PID="$(tr -d '[:space:]' < "$LOCK" 2>/dev/null || true)"

if [ -z "$PID" ] || ! [[ "$PID" =~ ^[0-9]+$ ]]; then
  rm -f "$LOCK"
  echo "[LOCK] Removido lock inválido"
  exit 0
fi

if ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$LOCK"
  echo "[LOCK] Removido lock órfão (PID $PID não existe)"
  exit 0
fi

if [ -r "/proc/$PID/cmdline" ]; then
  CMD="$(tr '\0' ' ' < "/proc/$PID/cmdline" 2>/dev/null || true)"
  if echo "$CMD" | grep -qE 'hanork.*src/bot\.js|hanork.*ecosystem\.config'; then
    echo "[LOCK] Bot ativo (PID $PID) — lock mantido"
    exit 0
  fi
fi

rm -f "$LOCK"
echo "[LOCK] Removido lock de processo não-Hanork (PID $PID)"
