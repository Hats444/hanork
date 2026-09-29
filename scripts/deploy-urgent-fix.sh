#!/usr/bin/env bash
set -euo pipefail

export PATH="/home/vendetta/.nvm/versions/node/v25.2.1/bin:${PATH}"
HANORK="${HANORK_ROOT:-/home/vendetta/hanork}"
WIN="${WIN_HANORK:-/mnt/c/Users/boots/Downloads/hanork}"

echo "[deploy-urgent] rsync src + zero-divu (no node_modules)..."
rsync -a --delete "$WIN/src/" "$HANORK/src/"
rsync -a --delete \
  --exclude node_modules \
  --exclude database/session \
  --exclude '*.log' \
  "$WIN/zero-divu/" "$HANORK/zero-divu/"
cp "$WIN/docs/HANORK-STATUS.md" "$HANORK/docs/HANORK-STATUS.md"

cd "$HANORK"
echo "[deploy-urgent] native deps..."
npm install --omit=dev
npm rebuild better-sqlite3 2>/dev/null || true
bash scripts/setup-zero-divu-wsl.sh

echo "[deploy-urgent] single restart..."
bash scripts/hanork-ctl.sh restart
sleep 25
bash scripts/hanork-ctl.sh status

echo "[deploy-urgent] restore wa admin..."
node scripts/restore-wa-admin.js 2>&1 || true
sleep 8

echo "[deploy-urgent] processes:"
pgrep -af 'bot.js|connect.js' || true

echo "[deploy-urgent] validate-production..."
node scripts/validate-production.js
