'use strict';
require('dotenv').config({ quiet: true });
const { connect } = require('../src/config/database-sqlite');
const db = connect();

const tgId = process.argv[2] || '8374207443';

const user = db.prepare('SELECT id, first_name, username FROM users WHERE telegram_id = ?').get(tgId);
console.log('user:', user);

const orders = db
    .prepare(
        `SELECT id, status, payment_method, total, paid_at, created_at
         FROM orders
         WHERE user_id = ?
         ORDER BY COALESCE(paid_at, created_at) DESC
         LIMIT 15`
    )
    .all(user?.id || -1);

console.log('\n=== pedidos ===');
for (const o of orders) {
    const kv = db.prepare('SELECT updated_at FROM kv_store WHERE key = ?').get(`sales_ref_posted:${o.id}`);
    console.log({
        id: o.id.slice(-12),
        status: o.status,
        method: o.payment_method,
        total: o.total,
        paid_at: o.paid_at,
        ref_posted: kv?.updated_at || null,
    });
}

const vo = db
    .prepare(
        `SELECT vo.* FROM virtuo_orders vo
         JOIN orders o ON o.id = vo.hanork_order_id
         WHERE o.user_id = ?
         ORDER BY vo.id DESC LIMIT 5`
    )
    .all(user?.id || -1);
console.log('\n=== virtuo ===', vo.map((v) => ({
    id: v.id,
    hanork: v.hanork_order_id?.slice(-12),
    status: v.status,
    country: v.country_name,
    phone: v.phone,
})));
