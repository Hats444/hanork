#!/usr/bin/env node
'use strict';
const root = require('path').join(__dirname, '..');
process.chdir(root);
require('dotenv').config();
const db = require('../src/config/database-sqlite').connect();
const ids = process.argv.slice(2);
const rows = db.prepare(
    `SELECT hanork_order_id, status, phone, virtuo_order_id, provider_status FROM virtuo_orders WHERE hanork_order_id IN (${ids.map(() => '?').join(',')})`
).all(...ids);
console.log(JSON.stringify(rows, null, 2));
