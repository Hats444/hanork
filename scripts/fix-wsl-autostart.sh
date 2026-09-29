#!/usr/bin/env bash
# Substitui start-hanork.sh quebrado (PM2 + Node 20) por hanork-ctl start-bg
set -euo pipefail

HANORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
START_SCRIPT="${HOME}/start-hanork.sh"

cat > "$START_SCRIPT" <<EOF
#!/usr/bin/env bash
# Hanork @reboot — gerado por scripts/fix-wsl-autostart.sh
export HANORK_AUTOSTART=0
bash "$HANORK_DIR/scripts/hanork-ctl.sh" start-bg >> "\${HOME}/hanork-boot.log" 2>&1
EOF

chmod +x "$START_SCRIPT"
echo "[✓] Atualizado: $START_SCRIPT"
echo "    Crontab: @reboot $START_SCRIPT"
