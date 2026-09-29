#!/bin/bash
export PATH=/home/vendetta/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin
sleep 15
curl -s -m 15 http://127.0.0.1:3000/health/live || echo CURL_FAIL
echo
pgrep -f "node src/bot.js" | head -1
cat /home/vendetta/hanork/.bot.lock 2>/dev/null
