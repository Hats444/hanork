'use strict';

const VirtuoOrderRepository = require('../repositories/virtuoOrderRepository');

function cancelVirtuoHanorkOrder(hanorkOrderId) {
    const row = VirtuoOrderRepository.findByHanorkOrderId(hanorkOrderId);
    if (!row) return false;
    if (['completed', 'cancelled'].includes(String(row.status).toLowerCase())) return false;
    VirtuoOrderRepository.updateStatus(row.id, 'failed', { provider_status: 'checkout_abandoned' });
    return true;
}

module.exports = { cancelVirtuoHanorkOrder };
