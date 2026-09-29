#!/usr/bin/env node
'use strict';
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');
const { connect } = require('../src/config/database-sqlite');
connect();
const db = connect();
console.log('--- últimos orders ---');
console.log(db.prepare('SELECT id, status, total, payment_method, user_id FROM orders ORDER BY rowid DESC LIMIT 10').all());
console.log('--- order 63f061cc ---');
const id = '63f061cc-1277-4cbc-8bb6-f1657f5d36e7';
console.log('order:', db.prepare('SELECT * FROM orders WHERE id=?').get(id));
console.log('smm:', db.prepare('SELECT * FROM smm_orders WHERE hanork_order_id=?').get(id));
console.log('--- order ab48ee5a ---');
const id2 = 'ab48ee5a-40d8-4308-848d-638143ff799e';
console.log('order:', db.prepare('SELECT id,status,total,payment_method,user_id FROM orders WHERE id=?').get(id2));
console.log('smm:', db.prepare('SELECT * FROM smm_orders WHERE hanork_order_id=?').get(id2));
console.log('user 7970364057:', db.prepare("SELECT id FROM users WHERE telegram_id='7970364057'").get());
