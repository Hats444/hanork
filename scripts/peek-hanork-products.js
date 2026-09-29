'use strict';
require('dotenv').config({ quiet: true });
const { connect } = require('../src/config/database-sqlite');
const db = connect();
const rows = db.prepare('SELECT id, name, price, active FROM products ORDER BY id').all();
console.log(JSON.stringify(rows, null, 2));
