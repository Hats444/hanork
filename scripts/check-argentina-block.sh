#!/usr/bin/env bash
set -euo pipefail
cd /home/vendetta/hanork
export HANORK_DB_PATH=/home/vendetta/.hanork/hanork.db
NODE=/home/vendetta/.nvm/versions/node/v20.20.2/bin/node
sqlite3 "$HANORK_DB_PATH" "SELECT key, datetime(value/1000,'unixepoch') FROM kv_store WHERE key LIKE 'virtuo_block:wa:39%' LIMIT 5;"
$NODE -e "
const db=require('./src/config/database-sqlite').connect();
const rows=db.prepare(\"SELECT id,service_code,country_name,country_id,server,active,available FROM virtuo_services WHERE service_code='wa' AND country_name LIKE '%Argent%'\").all();
console.log(JSON.stringify(rows,null,2));
"
