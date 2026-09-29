#!/bin/bash
export PATH=/home/vendetta/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin
cd /home/vendetta/hanork || exit 1
pgrep -af bot.js
pgrep -af connect.js
for p in $(pgrep -f "/home/vendetta/hanork/zero-divu/connect.js"); do echo PID $p; tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | grep ZERO_DIVU_IPC; done
