#!/usr/bin/env bash
set -euo pipefail
HANORK=/home/vendetta/hanork
WIN=/mnt/c/Users/boots/Downloads/hanork
files=(
  src/telegram/menus/menuCopy.js
  src/telegram/menus/MenuKeyboards.js
  src/telegram/menus/mainMenuHandlers.js
  src/telegram/menus/adminPanelUi.js
  src/bot/createBotContext.js
  src/utils/catalogBrowse.js
  src/utils/buttonLabels.js
  src/telegram/callbacks/payment/paymentUi.js
  src/telegram/callbacks/payment/registerPaymentActions.js
  src/telegram/navKeyboard.js
  src/config/salesReferenceChannel.js
  src/modules/smm/smmAccess.js
  src/modules/smm/utils/smmLabels.js
  src/modules/smm/helpers/smmUserNotify.js
  src/telegram/groupGuard.js
  src/telegram/groupPromo.js
  src/telegram/commands/user/userWelcomeTour.js
  src/telegram/commands/user/catalogHandlers.js
  src/telegram/referenceChannelGuard.js
  src/telegram/downloads/downloadsNav.js
  src/modules/user/UserAccountPanels.js
  src/services/AutoBroadcastService.js
  src/services/hanork-ai/HanorkAdminNative.js
  src/telegram/commands/aiCommands.js
  docs/audit/HANORK-MELHORIAS-GERAIS.md
)
for f in "${files[@]}"; do
  install -D "$WIN/$f" "$HANORK/$f"
  echo "OK $f"
done
# Marketing copy (200 arquivos)
rsync -a --delete "$WIN/marketing/" "$HANORK/marketing/"
echo "OK marketing/ (hanork + smm)"
bash "$HANORK/scripts/hanork-ctl.sh" restart
