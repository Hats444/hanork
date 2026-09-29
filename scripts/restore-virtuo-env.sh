#!/usr/bin/env bash
set -euo pipefail

HANORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV="$HANORK_DIR/.env"
LOG="${HANORK_TERMINAL_LOG:-$HOME/.hanork/terminal.log}"

KEY="$(grep -ao 'vtk_[A-Za-z0-9_-]*' "$LOG" 2>/dev/null | awk '{ print length, $0 }' | sort -rn | head -1 | cut -d' ' -f2-)"
if [ -z "$KEY" ]; then
  echo "[!] VIRTUO_API_KEY não encontrada no log: $LOG"
  exit 1
fi

cp "$ENV" "$ENV.bak.$(date +%Y%m%d-%H%M%S)"

if ! grep -q '^VIRTUO_ENABLED=' "$ENV"; then
  {
    echo ''
    echo "# ─── Virtuo SMS (restaurado $(date +%F)) ───"
    sed -n '570,590p' "$HANORK_DIR/.env.example" | grep '^VIRTUO'
  } >> "$ENV"
fi

sed -i "s/^VIRTUO_ENABLED=.*/VIRTUO_ENABLED=1/" "$ENV"
sed -i "s/^VIRTUO_PUBLIC=.*/VIRTUO_PUBLIC=1/" "$ENV"
sed -i "s|^VIRTUO_API_KEY=.*|VIRTUO_API_KEY=${KEY}|" "$ENV"

echo '[✓] VIRTUO restaurado no .env:'
grep '^VIRTUO_' "$ENV" | sed 's/API_KEY=.*/API_KEY=***ok***/'
