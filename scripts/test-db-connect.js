'use strict';
const { connect, DB_PATH } = require('../src/config/database-sqlite');
const db = connect();
const row = db.prepare('SELECT COUNT(*) AS c FROM products').get();
console.log('OK', DB_PATH, 'products=', row.c);
