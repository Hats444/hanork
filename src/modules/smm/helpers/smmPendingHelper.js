'use strict';

const SmmOrderRepository = require('../repositories/smmOrderRepository');

function isSmmHanorkOrder(orderId) {
    if (!orderId) return false;
    const row = SmmOrderRepository.findByHanorkOrderId(orderId);
    return !!row;
}

async function resolveSmmPendingFromRedis(orderId) {
    try {
        const { getStateManager } = require('../../state');
        const sm = getStateManager();
        const purchaseKey = await sm.findPendingPurchaseByOrderId(orderId);
        if (!purchaseKey) return null;
        const pending = await sm.getPendingPurchase(purchaseKey);
        if (pending?.orderKind === 'smm') return pending;
    } catch (_) { /* ignore */ }
    return null;
}

module.exports = { isSmmHanorkOrder, resolveSmmPendingFromRedis };
