#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:${PATH}"
WIN=/mnt/c/Users/boots/Downloads/hanork
WSL=/home/vendetta/hanork

echo "[1] sync router + zerotwo"
rsync -a --delete "$WIN/src/services/hanork-ai/" "$WSL/src/services/hanork-ai/"
cp -f "$WIN/src/services/HanorkInvokeRouter.js" "$WSL/src/services/"
cp -f "$WIN/src/services/PlayMusicService.js" "$WSL/src/services/"
cp -f "$WIN/src/services/ZeroTwoAiService.js" "$WSL/src/services/"
cp -f "$WIN/src/telegram/middlewares/textCatchAllHandler.js" "$WSL/src/telegram/middlewares/"
cp -f "$WIN/src/config/config.js" "$WSL/src/config/"
cp -f "$WIN/src/config/zerotwoEndpoints.js" "$WSL/src/config/"
cp -f "$WIN/src/config/zerotwoReachability.js" "$WSL/src/config/"
cp -f "$WIN/src/bot/createBotContext.js" "$WSL/src/bot/"

echo "[2] patch ZEROTWO_API no .env"
ENV="$WSL/.env"
if grep -q 'zero-two-apis.com.br' "$ENV" 2>/dev/null; then
  sed -i 's|https://zero-two-apis.com.br|https://zero-two-apis.store|g' "$ENV"
  echo "  .env atualizado .com.br -> .store"
else
  grep ZEROTWO_API "$ENV" | head -1 || echo "  ZEROTWO_API não encontrado"
fi

echo "[3] restart"
cd "$WSL"
bash scripts/hanork-ctl.sh restart-bg
sleep 50
bash scripts/hanork-ctl.sh status
curl -sf http://127.0.0.1:3000/health/live && echo " HEALTH_OK" || echo " HEALTH_FAIL"
node scripts/test-zerotwo-api.js 2>&1 | tail -8
