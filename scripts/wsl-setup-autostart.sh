#!/bin/bash
set -euo pipefail

BRC="$HOME/.bashrc"
DST="$HOME/hanork"
PM2="$HOME/.nvm/versions/node/v20.20.2/bin/pm2"

cp "$BRC" "${BRC}.bak.$(date +%Y%m%d%H%M%S)"

grep -v '# Hanork Bot Autostart' "$BRC" | \
grep -v 'cd /mnt/c/users/boots/downloads/hanork' | \
grep -v 'node src/bot.js' | \
grep -v '# Hanork Bot — banner + PM2' | \
grep -v 'export HANORK_DIR=' | \
grep -v 'export PM2_BIN=' | \
grep -v 'hanork-session-start.sh' > "${BRC}.tmp"

mv "${BRC}.tmp" "$BRC"

cat >> "$BRC" << 'EOF'

# Hanork Bot — banner + PM2 (~/hanork, sem duplicar node)
export HANORK_DIR="$HOME/hanork"
export PM2_BIN="$HOME/.nvm/versions/node/v20.20.2/bin/pm2"
[ -x "$HANORK_DIR/scripts/hanork-session-start.sh" ] && "$HANORK_DIR/scripts/hanork-session-start.sh"
EOF

chmod +x "$DST/scripts/"*.sh "$DST/bot.sh" 2>/dev/null || true
bash "$DST/scripts/cleanup-bot-lock.sh" "$DST" 2>/dev/null || true

export HANORK_DIR="$DST"
export PM2_BIN="$PM2"
bash "$DST/bot.sh" boot

"$PM2" save --silent 2>/dev/null || true

echo ""
echo "=== PM2 ==="
"$PM2" list

echo ""
echo "=== MOTD test ==="
bash "$DST/scripts/hanork-motd.sh"

echo ""
echo "=== .bashrc Hanork ==="
grep -n 'Hanork\|hanork' "$BRC" || true

echo ""
echo "OK — Ubuntu/WSL configurado."
