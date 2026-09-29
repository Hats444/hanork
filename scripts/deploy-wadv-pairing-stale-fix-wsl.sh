#!/usr/bin/env bash
set -euo pipefail
HANORK="${HANORK_ROOT:-/home/vendetta/hanork}"
WIN="${WIN_HANORK:-/mnt/c/Users/boots/Downloads/hanork}"
TEST_UID="${WADV_TEST_UID:-8115302402}"

echo "[deploy-wadv-pairing-stale-fix] stale partial wipe + Connection Closed fix…"

for f in \
  zero-divu/connect.js \
  src/modules/wa-divulgacao/waDivulgacaoLoginService.js
do
  cp "$WIN/$f" "$HANORK/$f"
  sed -i 's/\r$//' "$HANORK/$f"
  node --check "$HANORK/$f"
done

# Limpa pareamento parcial expirado do usuário de teste (se existir)
AUTH_DIR="/home/vendetta/.hanork/wa-users/${TEST_UID}/session/auth"
if [[ -f "$AUTH_DIR/creds.json" ]]; then
  REGISTERED=$(node -e "
    const fs=require('fs');
    const c=JSON.parse(fs.readFileSync('$AUTH_DIR/creds.json','utf8'));
    process.stdout.write(c.registered?'1':'0');
  " 2>/dev/null || echo "0")
  if [[ "$REGISTERED" != "1" ]]; then
    echo "[deploy-wadv-pairing-stale-fix] wiping stale partial session uid=$TEST_UID"
    rm -rf "/home/vendetta/.hanork/wa-users/${TEST_UID}/session/auth"
    mkdir -p "$AUTH_DIR"
  fi
fi

cd "$HANORK"
bash scripts/hanork-ctl.sh stop || true
sleep 2
bash scripts/hanork-ctl.sh start-bg
sleep 35
BOT_PID=$(pgrep -f 'node src/bot.js' | head -1 || true)
echo "[deploy-wadv-pairing-stale-fix] bot PID: ${BOT_PID:-none}"
grep -a 'WaDivulgacao.*ativo\|Pareamento parcial expirado\|Módulo desligado' /home/vendetta/.hanork/terminal.log 2>/dev/null | tail -5 || true
