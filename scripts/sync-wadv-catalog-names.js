'use strict';
require('dotenv').config();
const { ensureWaDivulgacaoProducts } = require('../src/modules/wa-divulgacao/waDivulgacaoProductService');
const { catalogButtonLabel } = require('../src/utils/productListing');
const { connect } = require('../src/config/database-sqlite');

const r = ensureWaDivulgacaoProducts();
const db = connect();
const rows = db
    .prepare(`SELECT id, name, price FROM products WHERE category = 'wa_divulgacao' AND active = 1 ORDER BY price`)
    .all();
console.log('sync', r);
for (const p of rows) {
    console.log(p.id, catalogButtonLabel(p, 14));
}
