'use strict';
require('dotenv').config({ quiet: true });
const { connect } = require('../src/config/database-sqlite');
const db = connect();
const rows = db.prepare('SELECT id,name,price,category,active,description FROM products ORDER BY id').all();
for (const r of rows) {
    const desc = String(r.description || '').replace(/\s+/g, ' ').slice(0, 100);
    console.log(`${r.id}|${r.price}|${r.category || '-'}|${r.active ? 'on' : 'off'}|${r.name}|${desc}`);
}
