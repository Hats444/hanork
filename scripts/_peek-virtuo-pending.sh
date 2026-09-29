#!/usr/bin/env bash
set -euo pipefail
DB="${1:-/home/vendetta/.hanork/hanork.db}"
sqlite3 "$DB" "SELECT id, telegram_id, status, virtuo_order_id, phone, substr(hanork_order_id,1,8) FROM virtuo_orders WHERE status IN ('paid','waiting_sms') ORDER BY id DESC LIMIT 15;"
echo '---'
sqlite3 "$DB" "SELECT telegram_id, username FROM users WHERE username LIKE '%yasmin%' OR telegram_id='8372707294';"
