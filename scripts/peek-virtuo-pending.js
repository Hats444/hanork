#!/usr/bin/env node
'use strict';
process.env.HANORK_DB_PATH = process.env.HANORK_DB_PATH || '/home/vendetta/.hanork/hanork.db';
const { connect } = require('../src/config/database-sqlite');
const db = connect();
console.log('by status:', db.prepare('SELECT status, COUNT(*) n FROM virtuo_orders GROUP BY status').all());
console.log('pending:', db.prepare("SELECT id, telegram_id, status, virtuo_order_id FROM virtuo_orders WHERE status IN ('paid','waiting_sms')").all());
