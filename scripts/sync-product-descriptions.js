'use strict';

/**
 * Sincroniza description no SQLite a partir de productPromoTemplates.js
 * Uso: node scripts/sync-product-descriptions.js
 */
require('../src/config/env');
const { connect, DB_PATH } = require('../src/config/database-sqlite');
const { getProductPromoBody } = require('../src/data/productPromoTemplates');
const { normalizeProductDescription } = require('../src/utils/normalizeProductDescription');

const db = connect();
const update = db.prepare('UPDATE products SET description = ? WHERE id = ?');
const rows = db.prepare('SELECT id, name, description FROM products ORDER BY id').all();

let updated = 0;
for (const row of rows) {
  const body = getProductPromoBody(row);
  if (!body) {
    const fixed = normalizeProductDescription(row.description);
    if (fixed && fixed !== row.description) {
      update.run(fixed, row.id);
      console.log(`fix id=${row.id} (${row.name}) — normalizou \\n literal`);
      updated++;
    } else {
      console.log(`skip id=${row.id} (${row.name}) — sem template`);
    }
    continue;
  }
  update.run(body, row.id);
  updated++;
  console.log(`ok id=${row.id} (${row.name}) — ${body.length} chars`);
}

console.log(`\n${updated}/${rows.length} produtos · DB: ${DB_PATH}`);
