#!/usr/bin/env node
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

const { connect } = require('../src/config/database-sqlite');
const { SalesReferenceChannelService } = require('../src/services/SalesReferenceChannelService');
const { isSalesRefChannel, getSalesRefChannelId } = require('../src/config/salesReferenceChannel');

let ok = 0;
let fail = 0;

function assert(cond, msg) {
    if (cond) {
        ok++;
        console.log('  OK', msg);
    } else {
        fail++;
        console.log('  FAIL', msg);
    }
}

connect();

assert(isSalesRefChannel('-1004426605532'), 'hanorkinfos id');
assert(!isSalesRefChannel('-100123'), 'other channel not ref');
assert(getSalesRefChannelId() === '-1004426605532', 'default channel id');

const db = connect();
const smmOrder = db
    .prepare('SELECT hanork_order_id FROM smm_orders WHERE hanork_order_id IS NOT NULL LIMIT 1')
    .get();
const productOrder = db
    .prepare(
        `SELECT o.id FROM orders o
         INNER JOIN order_items oi ON oi.order_id = o.id
         WHERE o.status IN ('PAID','DELIVERED') LIMIT 1`
    )
    .get();

const svc = new SalesReferenceChannelService({
    bot: { telegram: { sendMessage: async () => ({ message_id: 1 }) } },
    dbRaw: () => db,
});

if (smmOrder?.hanork_order_id) {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(smmOrder.hanork_order_id);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(order.user_id);
    const msg = svc.buildMessage(order, { orderKind: 'smm', total: order.total });
    assert(msg.includes('SMM'), 'SMM message kind');
    assert(msg.includes('Venda confirmada'), 'SMM message header');
    assert(msg.includes('Cliente'), 'user section');
    assert(msg.includes('<code>'), 'telegram id code');
    if (user?.username) assert(msg.includes('@'), 'username when set');
} else {
    console.log('  SKIP no SMM order for message test');
}

if (productOrder?.id) {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(productOrder.id);
    const msg = svc.buildMessage(order, { items: [], total: order.total });
    assert(msg.includes('Produto'), 'product message kind');
} else {
    console.log('  SKIP no product order for message test');
}

console.log(`\n${ok} ok, ${fail} fail\n`);
process.exit(fail ? 1 : 0);
