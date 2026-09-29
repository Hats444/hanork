'use strict';

function isVirtuoHanorkOrder(orderId) {
    if (!orderId) return false;
    const VirtuoOrderRepository = require('../repositories/virtuoOrderRepository');
    return !!VirtuoOrderRepository.findByHanorkOrderId(orderId);
}

async function resolveVirtuoPendingFromRedis(orderId) {
    try {
        const { getStateManager } = require('../../state');
        const sm = getStateManager();
        const purchaseKey = await sm.findPendingPurchaseByOrderId(orderId);
        if (!purchaseKey) return null;
        const pending = await sm.getPendingPurchase(purchaseKey);
        if (pending?.orderKind === 'virtuo') return pending;
    } catch (_) {
        /* ignore */
    }
    return null;
}

module.exports = { isVirtuoHanorkOrder, resolveVirtuoPendingFromRedis };
