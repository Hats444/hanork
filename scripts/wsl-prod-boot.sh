#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
cd /home/vendetta/hanork

echo "[*] npm install..."
npm install --omit=dev

echo "[*] npm rebuild better-sqlite3..."
npm rebuild better-sqlite3

echo "[*] Verificando módulos críticos..."
node -e "
require('fs-extra');
require('better-sqlite3')(':memory:');
require('./src/modules/affiliate/AffiliatePanels');
console.log('deps OK');
"

echo "[*] Subindo bot..."
bash scripts/hanork-ctl.sh start-bg
bash scripts/hanork-ctl.sh status
