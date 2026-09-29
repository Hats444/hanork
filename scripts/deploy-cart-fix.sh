#!/usr/bin/env bash
set -euo pipefail
SRC=/mnt/c/Users/boots/Downloads/hanork
DST=/home/vendetta/hanork
FILES=(
  src/telegram/menus/MenuKeyboards.js
  src/telegram/commands/user/catalogHandlers.js
  src/telegram/commands/user/shopCommands.js
  src/services/CheckoutService.js
  src/telegram/commands/admin/panelHandlers.js
  src/telegram/commands/admin/ordersHandlers.js
  src/bot/registerHanorkBot.js
)
for f in "${FILES[@]}"; do
  cp "$SRC/$f" "$DST/$f"
  echo "deployed $f"
done
echo "--- node --check ---"
for f in "${FILES[@]}"; do
  node --check "$DST/$f"
  echo "OK $f"
done
