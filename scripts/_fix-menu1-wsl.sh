#!/usr/bin/env bash
set -euo pipefail
SRC='/mnt/c/Users/boots/Downloads/perfil pc.jpg'
INFOS=/home/vendetta/hanork/infos
BACKUP="$INFOS/menu.jpg.corrupt.bak"

if [ ! -f "$SRC" ]; then
  echo "FATAL: $SRC not found"
  exit 1
fi

echo "[1] backup corrupt menu.jpg ($(stat -c%s "$INFOS/menu.jpg") bytes)"
cp -a "$INFOS/menu.jpg" "$BACKUP"

echo "[2] restore menu.jpg from perfil pc.jpg"
cp -f "$SRC" "$INFOS/menu.jpg"
chmod 664 "$INFOS/menu.jpg"

echo "[3] verify"
file "$INFOS/menu.jpg"
ls -la "$INFOS/menu.jpg"
md5sum "$SRC" "$INFOS/menu.jpg"

echo "[4] sync hanork/infos copy if exists"
if [ -d /home/vendetta/hanork/hanork/infos ]; then
  cp -f "$SRC" /home/vendetta/hanork/hanork/infos/menu.jpg
fi

echo "[5] invalidate cache via touch siblings"
touch "$INFOS"/menu*.jpg

echo "DONE menu1 restored"
