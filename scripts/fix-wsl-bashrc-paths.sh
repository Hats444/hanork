#!/usr/bin/env bash
# Corrige ~/.bashrc: autostart/aliases apontam para ~/hanork (prod), não /mnt/c/
set -euo pipefail

BC="${HOME}/.bashrc"
PROD="${HOME}/hanork"

if [ ! -f "$BC" ]; then
  echo "[!] $BC não encontrado"
  exit 1
fi

cp "$BC" "${BC}.bak.$(date +%Y%m%d%H%M%S)"

sed -i 's|/mnt/c/Users/boots/Downloads/hanork|/home/vendetta/hanork|g' "$BC"

python3 << 'PY'
from pathlib import Path

p = Path.home() / ".bashrc"
text = p.read_text(encoding="utf-8", errors="replace")
marker = "# AUTO START — primeiro terminal sobe o bot"
start = "# ==================================================\n# AUTO START"
end_marker = "# HANORK START"

if start in text and end_marker in text:
    i = text.index(start)
    j = text.index(end_marker)
    text = text[:i] + text[j:]
    p.write_text(text, encoding="utf-8")
    print("[OK] Bloco AUTO START duplicado removido")
else:
    print("[i] Bloco AUTO START duplicado não encontrado (já removido?)")
PY

echo "[OK] Aliases e paths -> $PROD"
echo "     Recarregue: source ~/.bashrc"
