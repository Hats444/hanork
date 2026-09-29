'use strict';

const SmmOrderRepository = require('../repositories/smmOrderRepository');
const { ORDER_STATUS } = require('../constants/orderStatuses');

const CANCELABLE = new Set([
    ORDER_STATUS.AWAITING_PAYMENT,
    ORDER_STATUS.PENDING,
    'awaiting_payment',
    'pending',
]);

function cancelSmmHanorkOrder(hanorkOrderId) {
    const row = SmmOrderRepository.findByHanorkOrderId(hanorkOrderId);
    if (!row) return { updated: false, reason: 'not_found' };
    if (!CANCELABLE.has(row.status)) {
        return { updated: false, reason: 'not_cancelable', status: row.status };
    }
    SmmOrderRepository.updateStatus(row.id, ORDER_STATUS.CANCELED);
    return { updated: true, smmOrderId: row.id };
}

module.exports = { cancelSmmHanorkOrder };
