#!/usr/bin/env bash
set -euo pipefail
HANORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HANORK_DIR"

export PATH="${HOME}/.nvm/versions/node/v20.20.2/bin:${PATH}"
echo "[fix] Node: $(node -v)"

node scripts/ensure-native-sqlite.js

bash scripts/hanork-ctl.sh stop 2>/dev/null || true
sleep 2

# Marca sessão nova — evita falso positivo de BOOT-FATAL antigo no log
echo "" >> "${HOME}/.hanork/terminal.log"
echo "════════════════════════════════════════════════════════════" >> "${HOME}/.hanork/terminal.log"
echo "[$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)] Reinício manual (fix-and-restart)" >> "${HOME}/.hanork/terminal.log"

bash scripts/hanork-ctl.sh start-bg || {
  echo "[fix] start-bg falhou — tentando foreground curto para diagnóstico…"
  timeout 15 bash scripts/node-hanork.sh || true
  exit 1
}

echo "[fix] Aguardando boot (~150s)…"
for i in $(seq 1 75); do
  sleep 2
  if bash scripts/hanork-ctl.sh status 2>/dev/null | grep -q 'Bot rodando'; then
    echo "[fix] Bot online após $((i * 2))s"
    break
  fi
done

echo "[fix] Status:"
bash scripts/hanork-ctl.sh status

echo "[fix] Workers:"
pgrep -af 'connect.js' || echo "(nenhum worker ainda — boot pode levar mais ~1 min)"

echo "[fix] Últimas linhas do boot:"
tail -25 "${HOME}/.hanork/terminal.log" | sed 's/\x1b\[[0-9;]*m//g'
