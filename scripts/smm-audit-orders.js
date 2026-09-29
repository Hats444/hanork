#!/usr/bin/env node
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

const { connect } = require('../src/config/database-sqlite');
connect();

const rows = connect()
    .prepare(
        `SELECT s.id, s.status, s.provider_order_id, s.telegram_id, s.link,
                o.status AS ostatus, o.payment_method, o.payment_id, o.paid_at, o.total
         FROM smm_orders s
         JOIN orders o ON o.id = s.hanork_order_id
         ORDER BY s.id DESC`
    )
    .all();

console.log('\n=== Auditoria SMM (todos os pedidos) ===\n');
console.log('Total:', rows.length);

const real = rows.filter(
    (r) => r.provider_order_id && !String(r.provider_order_id).startsWith('DRY')
);
console.log('Com provider real (não mock):', real.length);
console.log('');

for (const r of rows) {
    const prov = r.provider_order_id || '—';
    const mock = String(prov).startsWith('DRY') ? ' [MOCK]' : '';
    console.log(
        `#${r.id} smm=${r.status} order=${r.ostatus} prov=${prov}${mock} tg=${r.telegram_id} R$${Number(r.total).toFixed(2)} ${r.payment_method || ''}`
    );
}

const paidNoProv = rows.filter(
    (r) => ['PAID', 'DELIVERED'].includes(r.ostatus) && !r.provider_order_id
);
const paidNoReal = rows.filter(
    (r) =>
        ['PAID', 'DELIVERED'].includes(r.ostatus) &&
        r.provider_order_id &&
        String(r.provider_order_id).startsWith('DRY')
);

if (paidNoProv.length) {
    console.log('\n⚠️  PAID/DELIVERED sem provider_order_id:', paidNoProv.map((x) => x.id));
}
if (paidNoReal.length) {
    console.log('\nℹ️  DELIVERED só com mock dry-run:', paidNoReal.map((x) => x.id));
}
if (real.length) {
    console.log('\n✅ E2E REAL confirmado:', real.map((x) => `#${x.id} prov=${x.provider_order_id}`).join(', '));
} else {
    console.log('\n⏳ Nenhum pedido com provider_order_id real no banco ainda.');
}
console.log('');
