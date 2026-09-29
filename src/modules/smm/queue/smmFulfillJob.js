'use strict';

const SmmFulfillmentService = require('../services/fulfillmentService');
const SmmOrderRepository = require('../repositories/smmOrderRepository');
const { applyFailureCredit } = require('../services/smmFailureRecoveryService');
const logger = require('../../../config/logger');

async function processSmmFulfill(job) {
    const { orderId } = job.data || {};
    const bot = global.botInstance;
    if (!orderId) {
        logger.warn('[SMM:job] fulfill sem orderId');
        return { ok: false };
    }

    try {
        return await SmmFulfillmentService.fulfillHanorkOrder(orderId, bot);
    } catch (e) {
        logger.error('[SMM:job] fulfill crash', { orderId, detail: e.message, stack: e.stack?.split('\n')[0] });
        const smmOrder = SmmOrderRepository.findByHanorkOrderId(orderId);
        if (smmOrder?.hanork_order_id) {
            await applyFailureCredit({
                hanorkOrderId: orderId,
                smmOrder,
                reason: 'fulfill_job_crash',
                detail: String(e.message || 'erro interno').slice(0, 180),
                bot,
                markFailed: true,
            });
        }
        return { ok: false, reason: 'fulfill_job_crash', detail: e.message };
    }
}

module.exports = { processSmmFulfill };
