#!/usr/bin/env node
'use strict';
const root = require('path').join(__dirname, '..');
process.chdir(root);
require('dotenv').config({ path: require('path').join(root, '.env') });
const { processAutomaticRefund } = require(require('path').join(
    root,
    'src/modules/virtuo/services/virtuoFailureRecoveryService'
));

const orderId = process.argv[2];
if (!orderId) {
    console.error('Usage: node scripts/refund-virtuo-order.js <hanork-order-id> [reason]');
    process.exit(1);
}

(async () => {
    const reason = process.argv[3] || 'out_of_stock';
    const r = await processAutomaticRefund(orderId, reason);
    console.log(JSON.stringify(r, null, 2));
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
