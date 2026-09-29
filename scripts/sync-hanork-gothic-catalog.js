'use strict';
require('dotenv').config({ quiet: true });
const path = require('path');
const { connect } = require('../src/config/database-sqlite');
const { writeHanorkOnlyCatalogFile, formatAllVariantsBonusFile } = require('../src/data/hanorkBroadcastVariants');
const fs = require('fs');

const db = connect();
let p;
try {
  p = db.prepare('SELECT * FROM products WHERE id = 15').get();
} catch (err) {
  console.warn('DB indisponível, usando produto #15 padrão:', err.message);
  p = { id: 15, name: 'Hanork PRO v3.0', price: 297.9 };
}
if (!p) {
  console.error('Produto #15 não encontrado');
  process.exit(1);
}

const payload = writeHanorkOnlyCatalogFile(p, { username: process.env.BOT_USERNAME || 'hanork_bot' });
const out = path.join(__dirname, '../fotos/DIVULGACAO-HANORK-PRO.txt');
fs.writeFileSync(out, formatAllVariantsBonusFile(), 'utf8');

console.log(`Catálogo WA: ${payload.variacoes.length} variantes`);
console.log(`Textos: ${out}`);
