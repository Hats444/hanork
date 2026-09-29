#!/usr/bin/env bash
set -euo pipefail
WIN=/mnt/c/Users/boots/Downloads/hanork
WSL=/home/vendetta/hanork
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:${PATH}"

cp -f "$WIN/src/plugins/zero-divu/spawnZeroWorker.js" "$WSL/src/plugins/zero-divu/"
cp -f "$WIN/src/plugins/zero-divu/waIpcHelper.js" "$WSL/src/plugins/zero-divu/"
cp -f "$WIN/src/plugins/zero-divu/ZeroDivuClient.js" "$WSL/src/plugins/zero-divu/"

cd "$WSL"
node -e "const s=require('./src/plugins/zero-divu/spawnZeroWorker'); console.log('exports', Object.keys(s).join(','));"

bash scripts/hanork-ctl.sh restart-bg
sleep 50
bash scripts/hanork-ctl.sh status

echo "=== check watchdog error gone ==="
tail -n 80 /home/vendetta/.hanork/terminal.log | sed 's/\x1b\[[0-9;]*m//g' | grep -iE "startConnectionWatchdog|is not a function|BOOT-FATAL" || echo "no spawn errors in tail"
