#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
HANORK="/home/vendetta/hanork"
WIN="/mnt/c/Users/boots/Downloads/hanork"

rsync -a --delete "$WIN/src/" "$HANORK/src/"
cd "$HANORK"
node -e "require('./src/modules/virtuo/jobs/activationMonitorJob'); console.log('monitor ok', require('./src/modules/virtuo/virtuoConfig').activationCancelAtMs)"
bash scripts/hanork-ctl.sh restart
sleep 20
bash scripts/hanork-ctl.sh status
