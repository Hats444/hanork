#!/usr/bin/env node
'use strict';
const root = require('path').join(__dirname, '..');
process.chdir(root);
require('dotenv').config({ path: require('path').join(root, '.env') });
const VirtuoFulfillmentService = require(require('path').join(root, 'src/modules/virtuo/services/fulfillmentService'));
const VirtuoOrderRepository = require(require('path').join(root, 'src/modules/virtuo/repositories/virtuoOrderRepository'));
const { ORDER_STATUS } = require(require('path').join(root, 'src/modules/virtuo/constants/orderStatuses'));

const orderId = process.argv[2];
if (!orderId) {
    console.error('Usage: node scripts/retry-virtuo-fulfill.js <hanork-order-id>');
    process.exit(1);
}

(async () => {
    const vo = VirtuoOrderRepository.findByHanorkOrderId(orderId);
    if (!vo) {
        console.error('virtuo order not found');
        process.exit(1);
    }
    if (vo.status === ORDER_STATUS.FAILED) {
        VirtuoOrderRepository.updateStatus(vo.id, ORDER_STATUS.PAID, { provider_status: null });
    }
    const bot = global.botInstance || { telegram: { sendMessage: async () => {} } };
    const r = await VirtuoFulfillmentService.fulfillHanorkOrder(orderId, bot, { forceRetry: true });
    console.log(JSON.stringify(r, null, 2));
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
