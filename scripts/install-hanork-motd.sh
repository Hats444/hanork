#!/bin/bash
# Instala banner Hanork no MOTD do Ubuntu (aparece no login SSH/terminal do sistema)
# Requer sudo para /etc/update-motd.d/
set -euo pipefail

BOT_DIR="${HANORK_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
SRC="$BOT_DIR/scripts/hanork-motd.sh"
DEST="/etc/update-motd.d/99-hanork"

if [ ! -f "$SRC" ]; then
  echo "Erro: $SRC não encontrado"
  exit 1
fi

echo "=== Instalar MOTD Hanork ==="
echo "Origem: $SRC"
echo "Destino: $DEST"
echo ""

sudo tee "$DEST" > /dev/null <<EOF
#!/bin/bash
# Hanork MOTD — gerado por install-hanork-motd.sh
export HANORK_DIR="$BOT_DIR"
export PM2_BIN="${PM2_BIN:-$HOME/.nvm/versions/node/v20.20.2/bin/pm2}"
bash "$SRC" 2>/dev/null || true
EOF

sudo chmod +x "$DEST"
sudo chmod 755 "$DEST"

# Atualiza MOTD agora
if command -v run-parts >/dev/null 2>&1; then
  sudo run-parts /etc/update-motd.d/ >/dev/null 2>&1 || true
fi

echo "✓ MOTD instalado. No próximo login você verá o banner Hanork."
echo ""
echo "Autostart do bot (cole no ~/.bashrc, REMOVA o node src/bot.js antigo):"
echo "  [ -x $BOT_DIR/scripts/hanork-session-start.sh ] && $BOT_DIR/scripts/hanork-session-start.sh"
