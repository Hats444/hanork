#!/usr/bin/env node
'use strict';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./hanork.db';
const { connect } = require('../src/config/database-sqlite');
const rows = connect().prepare('SELECT id,name,price,file_url,active,category FROM products ORDER BY id').all();
console.log(JSON.stringify(rows, null, 2));
