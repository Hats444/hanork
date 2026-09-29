#!/bin/bash
# Autostart seguro: banner + PM2 (uma vez por sessão WSL/Ubuntu)
# Coloque no ~/.bashrc:
#   [ -x ~/hanork/scripts/hanork-session-start.sh ] && ~/hanork/scripts/hanork-session-start.sh

HANORK_DIR="${HANORK_DIR:-$HOME/hanork}"
[ -d "$HANORK_DIR" ] || HANORK_DIR="/home/vendetta/hanork"
[ -d "$HANORK_DIR" ] || HANORK_DIR="/mnt/c/users/boots/downloads/hanork"

MARKER="${XDG_CACHE_HOME:-$HOME/.cache}/hanork-wsl-boot"
MOTD="$HANORK_DIR/scripts/hanork-motd.sh"
BOOT="$HANORK_DIR/bot.sh"

export HANORK_DIR
export PM2_BIN="${PM2_BIN:-$HOME/.nvm/versions/node/v20.20.2/bin/pm2}"

# Só na primeira shell após ligar o WSL (uptime < 3 min e marker antigo)
should_run=0
if [ -f /proc/uptime ]; then
  up_sec="$(awk '{print int($1)}' /proc/uptime)"
  if [ "$up_sec" -lt 180 ]; then
    boot_id="$(date +%Y%m%d)-$(awk '{print int($1)}' /proc/uptime)"
    if [ ! -f "$MARKER" ] || [ "$(cat "$MARKER" 2>/dev/null)" != "$boot_id" ]; then
      should_run=1
      mkdir -p "$(dirname "$MARKER")"
      echo "$boot_id" > "$MARKER"
    fi
  fi
fi

if [ "$should_run" -eq 1 ] && [ -x "$BOOT" ]; then
  [ -x "$MOTD" ] && bash "$MOTD"
  bash "$BOOT" boot
fi
