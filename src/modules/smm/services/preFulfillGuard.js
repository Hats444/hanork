'use strict';

const { computeOrderCost } = require('./pricingService');
const { isFulfillHealth } = require('../constants/serviceHealthStatuses');

/**
 * Validações antes de enviar pedido ao fornecedor (V2 onda E + D).
 */
async function assertFulfillAllowed({ provider, candidates, quantity }) {
    if (!candidates?.length) {
        return { ok: false, reason: 'no_candidates' };
    }

    const healthy = candidates.filter((c) => isFulfillHealth(c));
    if (!healthy.length) {
        return { ok: false, reason: 'no_healthy_candidates' };
    }

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: false, reason: 'invalid_quantity' };
    }

    const requiredCost = computeOrderCost(healthy[0].cost_price, qty, healthy[0].service_type);
    if (!Number.isFinite(requiredCost) || requiredCost <= 0) {
        return { ok: false, reason: 'invalid_cost' };
    }

    if (!provider?.getBalance) {
        return { ok: true, skipped: 'no_balance_api' };
    }

    try {
        const bal = await provider.getBalance();
        if (bal?.error) {
            return { ok: false, reason: 'balance_check_failed', detail: String(bal.message || bal.error) };
        }
        const balance = Number(bal.balance);
        if (!Number.isFinite(balance)) {
            return { ok: false, reason: 'balance_invalid' };
        }
        if (balance < requiredCost) {
            return {
                ok: false,
                reason: 'insufficient_provider_balance',
                balance,
                required: requiredCost,
            };
        }
        return { ok: true, balance, required: requiredCost };
    } catch (e) {
        return { ok: false, reason: 'balance_check_failed', detail: e.message };
    }
}

module.exports = { assertFulfillAllowed };
