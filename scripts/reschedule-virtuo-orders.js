#!/usr/bin/env node
'use strict';
const root = require('path').join(__dirname, '..');
process.chdir(root);
require('dotenv').config({ path: require('path').join(root, '.env') });

const VirtuoOrderRepository = require('../src/modules/virtuo/repositories/virtuoOrderRepository');
const { ORDER_STATUS } = require('../src/modules/virtuo/constants/orderStatuses');
const { scheduleVirtuoFulfill } = require('../src/modules/queue/QueueHelpers');

const ids = process.argv.slice(2);
if (!ids.length) {
    console.error('Usage: node scripts/reschedule-virtuo-orders.js <order-id> [...]');
    process.exit(1);
}

(async () => {
    for (const orderId of ids) {
        const vo = VirtuoOrderRepository.findByHanorkOrderId(orderId);
        if (!vo) {
            console.log(orderId, 'NOT_FOUND');
            continue;
        }
        if (vo.status === ORDER_STATUS.FAILED) {
            VirtuoOrderRepository.updateStatus(vo.id, ORDER_STATUS.PAID, { provider_status: null });
        }
        const r = await scheduleVirtuoFulfill(orderId, vo.telegram_id, vo.user_id);
        console.log(orderId, JSON.stringify(r));
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
