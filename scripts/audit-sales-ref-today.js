'use strict';

require('dotenv').config();
const db = require('../src/config/database-sqlite').connect();

const today = new Date().toISOString().slice(0, 10);
const orders = db.prepare(`
  SELECT id, status, total, payment_method, payment_id, paid_at, created_at, user_id
  FROM orders
  WHERE date(COALESCE(paid_at, created_at)) = date('now', 'localtime')
     OR paid_at LIKE ?
     OR created_at LIKE ?
  ORDER BY COALESCE(paid_at, created_at) DESC
`).all(today + '%', today + '%');

const posted = db.prepare("SELECT key FROM kv_store WHERE key LIKE 'sales_ref_posted:%'").all();
const postedSet = new Set(posted.map((r) => r.key.replace('sales_ref_posted:', '')));

console.log('=== Pedidos hoje ===');
for (const o of orders) {
  const wasPosted = postedSet.has(o.id);
  console.log(JSON.stringify({
    id: o.id.slice(-12),
    status: o.status,
    method: o.payment_method,
    total: o.total,
    paid_at: o.paid_at,
    posted: wasPosted,
  }));
}

const paidToday = orders.filter((o) => ['PAID', 'DELIVERED', 'DELIVERING'].includes(o.status));
const missing = paidToday.filter((o) => !postedSet.has(o.id));
console.log('\n=== Pagos hoje sem post no canal ===', missing.length);
for (const o of missing) {
  console.log(o.id, o.status, o.payment_method, o.total, o.paid_at);
}
