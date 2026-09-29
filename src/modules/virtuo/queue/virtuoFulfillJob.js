'use strict';

const VirtuoFulfillmentService = require('../services/fulfillmentService');
const logger = require('../../../config/logger');

async function processVirtuoFulfill(job) {
    const { orderId } = job.data || {};
    const bot = global.botInstance;
    if (!orderId) {
        logger.warn('[Virtuo:job] fulfill sem orderId');
        return { ok: false };
    }
    return VirtuoFulfillmentService.fulfillHanorkOrder(orderId, bot);
}

module.exports = { processVirtuoFulfill };
