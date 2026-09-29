'use strict';
require('dotenv').config();
const { connect } = require('../src/config/database-sqlite');
const db = connect();
const rows = db.prepare('SELECT id, name, price, active FROM products ORDER BY id').all();
for (const r of rows) {
    console.log(`${r.id}\t${r.price}\t${r.active ? 'on' : 'off'}\t${r.name}`);
}
const fs = db.prepare(
    "SELECT id, product_id, sale_price, original_price, active FROM flash_sales WHERE product_id=15 AND active=1"
).all();
if (fs.length) {
    console.log('\nflash_sales produto 15:');
    console.log(fs);
}
