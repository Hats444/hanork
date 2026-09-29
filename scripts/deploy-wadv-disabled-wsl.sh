#!/usr/bin/env bash
set -euo pipefail
HANORK="${HANORK_ROOT:-/home/vendetta/hanork}"
WIN="${WIN_HANORK:-/mnt/c/Users/boots/Downloads/hanork}"

echo "[deploy-wadv-disabled] Desligando Hanork Div para usuários (WA_DIVULGACAO_ENABLED=0)…"

for f in \
  src/modules/wa-divulgacao/waDivulgacaoAccess.js \
  src/modules/wa-divulgacao/waDivulgacaoConfig.js \
  src/modules/wa-divulgacao/waDivulgacaoCopy.js \
  src/modules/wa-divulgacao/callbacks/waDivulgacaoHandlers.js \
  src/modules/wa-divulgacao/commands/registerWaDivulgacaoCommands.js \
  src/modules/wa-divulgacao/handlers/waDivulgacaoPrivateText.js \
  src/telegram/menus/MenuKeyboards.js \
  src/telegram/referenceChannelGuard.js \
  src/services/hanork-ai/HanorkIntentEngine.js
do
  cp "$WIN/$f" "$HANORK/$f"
  sed -i 's/\r$//' "$HANORK/$f"
  node --check "$HANORK/$f"
done

ENV_FILE="$HANORK/.env"
if grep -q '^WA_DIVULGACAO_ENABLED=' "$ENV_FILE" 2>/dev/null; then
  sed -i 's/^WA_DIVULGACAO_ENABLED=.*/WA_DIVULGACAO_ENABLED=0/' "$ENV_FILE"
else
  echo 'WA_DIVULGACAO_ENABLED=0' >> "$ENV_FILE"
fi
echo "[deploy-wadv-disabled] WA_DIVULGACAO_ENABLED=$(grep '^WA_DIVULGACAO_ENABLED=' "$ENV_FILE" | tail -1)"

cd "$HANORK"
bash scripts/hanork-ctl.sh stop || true
sleep 2
bash scripts/hanork-ctl.sh start-bg
sleep 25
BOT_PID=$(pgrep -f 'node src/bot.js' | head -1 || true)
echo "[deploy-wadv-disabled] bot PID: ${BOT_PID:-none}"
grep -a 'WaDivulgacao.*desligado\|WA_DIVULGACAO_ENABLED' /home/vendetta/.hanork/terminal.log 2>/dev/null | tail -3 || true
