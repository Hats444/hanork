'use strict';

require('dotenv').config();
const db = require('../src/config/database-sqlite').connect();

const blocks = db.prepare("SELECT key, value FROM kv_store WHERE key LIKE 'virtuo_block:wa:39%'").all();
console.log('blocks:', blocks);

const rows = db.prepare(
    "SELECT id, service_code, country_name, country_id, server, active, available FROM virtuo_services WHERE service_code='wa' AND country_name LIKE '%Argent%'"
).all();
console.log('argentina rows:', JSON.stringify(rows, null, 2));
