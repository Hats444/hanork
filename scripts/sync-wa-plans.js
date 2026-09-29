#!/usr/bin/env node
'use strict';

const { ensureWaDivulgacaoProducts } = require('../src/modules/wa-divulgacao/waDivulgacaoProductService');
const { connect } = require('../src/config/database-sqlite');

ensureWaDivulgacaoProducts();

const rows = connect()
    .prepare("SELECT name, price FROM products WHERE category='wa_divulgacao' AND active=1 ORDER BY price")
    .all();

console.log('Zap PRO — preços atualizados:');
for (const r of rows) {
    console.log(`  ${r.name} → R$ ${Number(r.price).toFixed(2)}`);
}
