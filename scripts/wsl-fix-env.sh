#!/bin/bash
set -euo pipefail

ENV="$HOME/hanork/.env"
PM2="$HOME/.nvm/versions/node/v20.20.2/bin/pm2"
KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

grep -v '^ENCRYPTION_KEY=' "$ENV" | grep -v '^SECURITY_STRICT=' > "${ENV}.tmp" || true
mv "${ENV}.tmp" "$ENV"

cat >> "$ENV" << EOF

# Adicionado pelo setup WSL
ENCRYPTION_KEY=$KEY
SECURITY_STRICT=false
EOF

WIN="/mnt/c/users/boots/downloads/hanork/.env"
if [ -f "$WIN" ]; then
  for var in DASHBOARD_JWT_SECRET DASHBOARD_PASS_HASH MP_WEBHOOK_SECRET TOKEN_TELEGRAM TOKEN_MP ID_DONO; do
    line="$(grep "^${var}=" "$WIN" 2>/dev/null | head -1 || true)"
    if [ -n "$line" ]; then
      grep -v "^${var}=" "$ENV" > "${ENV}.t2"
      mv "${ENV}.t2" "$ENV"
      echo "$line" >> "$ENV"
    fi
  done
fi

"$PM2" restart hanork-bot --update-env
sleep 10
"$PM2" list
