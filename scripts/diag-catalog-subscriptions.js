'use strict';
const { connect } = require('../src/config/database-sqlite');
const { resolveProductFormat, formatCatalogKey } = require('../src/utils/productFormat');
const { catalogButtonLabel } = require('../src/utils/productListing');
const { parsePlanDaysFromProduct } = require('../src/modules/wa-divulgacao/waDivulgacaoPlans');

const db = connect();
const rows = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY id').all();
console.log('=== ACTIVE PRODUCTS ===');
for (const p of rows) {
  const fmt = resolveProductFormat(p);
  const key = formatCatalogKey(fmt);
  const days = p.is_subscription ? parsePlanDaysFromProduct(p) : '-';
  console.log(
  JSON.stringify({
    id: p.id,
    name: p.name?.slice(0, 40),
    price: p.price,
    category: p.category,
    is_sub: p.is_subscription,
    fmt,
    key,
    days,
    btn: catalogButtonLabel(p, 14),
  })
  );
}
