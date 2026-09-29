#!/usr/bin/env bash
export PATH="/home/vendetta/.nvm/versions/node/v20.20.2/bin:${PATH}"
kill -9 25668 2>/dev/null || true
sleep 1
if kill -0 25668 2>/dev/null; then echo "25668 still alive"; else echo "25668 dead"; fi
ps -p 25668 -o pid,cmd 2>/dev/null || echo "no process 25668"
pgrep -af 'hanork/zero-divu/connect' | head -10
