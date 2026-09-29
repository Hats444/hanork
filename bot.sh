#!/bin/bash
# Hanork — controle via PM2 (uma única instância)
set -euo pipefail

PM2="${PM2_BIN:-/home/vendetta/.nvm/versions/node/v20.20.2/bin/pm2}"
BOT_DIR="${HANORK_DIR:-/home/vendetta/hanork}"
ECOSYSTEM="$BOT_DIR/ecosystem.config.js"
CLEANUP="$BOT_DIR/scripts/cleanup-bot-lock.sh"

cd "$BOT_DIR"

cleanup_lock() {
  if [ -x "$CLEANUP" ]; then
    bash "$CLEANUP" "$BOT_DIR"
  elif [ -f "$BOT_DIR/.bot.lock" ]; then
    PID="$(tr -d '[:space:]' < "$BOT_DIR/.bot.lock" 2>/dev/null || true)"
    if [ -z "$PID" ] || ! kill -0 "$PID" 2>/dev/null; then
      rm -f "$BOT_DIR/.bot.lock"
      echo "[LOCK] Lock órfão removido"
    fi
  fi
}

pm2_online() {
  "$PM2" pid hanork-bot >/dev/null 2>&1
}

case "${1:-}" in
    start)
        if [ "${HANORK_SHOW_MOTD:-1}" != "0" ] && [ -x "$BOT_DIR/scripts/hanork-motd.sh" ]; then
            bash "$BOT_DIR/scripts/hanork-motd.sh"
        fi
        cleanup_lock
        if pm2_online; then
            echo "✓ hanork-bot já está online no PM2"
            "$PM2" list
            exit 0
        fi
        "$PM2" start "$ECOSYSTEM" --env production
        "$PM2" save --silent 2>/dev/null || true
        "$PM2" list
        ;;
    stop)
        "$PM2" stop hanork-bot 2>/dev/null || true
        sleep 2
        cleanup_lock
        "$PM2" list
        ;;
    restart)
        cleanup_lock
        if pm2_online; then
            "$PM2" restart hanork-bot --update-env
        else
            "$PM2" start "$ECOSYSTEM" --env production
        fi
        "$PM2" save --silent 2>/dev/null || true
        "$PM2" list
        ;;
    logs)
        "$PM2" logs hanork-bot --raw --lines 500
        ;;
    status)
        "$PM2" list
        ;;
    boot)
        # Uso no login / systemd — banner + PM2 (não duplica node)
        if [ "${HANORK_SHOW_MOTD:-1}" != "0" ] && [ -x "$BOT_DIR/scripts/hanork-motd.sh" ]; then
            bash "$BOT_DIR/scripts/hanork-motd.sh"
        fi
        cleanup_lock
        "$PM2" resurrect 2>/dev/null || "$PM2" start "$ECOSYSTEM" --env production
        "$PM2" save --silent 2>/dev/null || true
        ;;
    *)
        echo "Uso: bash bot.sh [start|stop|restart|logs|status|boot]"
        echo ""
        echo "  boot    — autostart (pm2 resurrect, sem matar instância)"
        ;;
esac
