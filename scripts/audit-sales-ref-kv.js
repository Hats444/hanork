'use strict';

require('dotenv').config();
const db = require('../src/config/database-sqlite').connect();

const orders = db.prepare(`
  SELECT id, status, payment_method, payment_id, total, paid_at
  FROM orders
  WHERE date(COALESCE(paid_at, created_at)) = date('now', 'localtime')
    AND status IN ('PAID','DELIVERED','DELIVERING','REFUNDED')
  ORDER BY paid_at
`).all();

for (const o of orders) {
  const kv = db.prepare('SELECT value, updated_at FROM kv_store WHERE key=?').get(`sales_ref_posted:${o.id}`);
  console.log({
    id: o.id.slice(-12),
    status: o.status,
    method: o.payment_method,
    total: o.total,
    kv: kv ? { at: kv.updated_at, ts: kv.value } : null,
  });
}
