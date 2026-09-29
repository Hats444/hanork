'use strict';
/**
 * Atualiza preço do Hanork Bot v3 (produto 1) no SQLite.
 * Uso: HANORK_PRODUCT_PRICE=250 node scripts/set-hanork-price.js
 */
require('dotenv').config();
const { connect } = require('../src/config/database-sqlite');
const PRODUCT_ID = Number(process.env.HANORK_PRODUCT_ID || '1');
const price = Number(process.env.HANORK_PRODUCT_PRICE || '297.9');
if (!Number.isFinite(price) || price <= 0) {
    console.error('HANORK_PRODUCT_PRICE inválido');
    process.exit(1);
}
const db = connect();
const row = db.prepare('SELECT id, name, price FROM products WHERE id = ?').get(PRODUCT_ID);
if (!row) {
    console.error(`Produto #${PRODUCT_ID} não encontrado`);
    process.exit(1);
}
db.prepare('UPDATE products SET price = ? WHERE id = ?').run(price, PRODUCT_ID);
const after = db.prepare('SELECT id, name, price FROM products WHERE id = ?').get(PRODUCT_ID);
console.log(`OK: #${after.id} ${after.name}`);
console.log(`   ${row.price} → ${after.price}`);
