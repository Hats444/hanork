'use strict';

const logger = require('../../../config/logger');
const VirtuoOrderRepository = require('../repositories/virtuoOrderRepository');
const VirtuoFulfillmentService = require('../services/fulfillmentService');
const VirtuoConfig = require('../virtuoConfig');
const { ORDER_STATUS, POLL_STATUSES } = require('../constants/orderStatuses');

async function runActivationMonitorJob(bot) {
    const open = VirtuoOrderRepository.listByStatus(POLL_STATUSES, 50);
    let updated = 0;
    let notified = 0;
    let timedOut = 0;

    for (const order of open) {
        if (!order.virtuo_order_id) continue;
        const since = Date.parse(order.updated_at || order.created_at || '');
        if (Number.isFinite(since) && Date.now() - since > VirtuoConfig.pollTimeoutMs) {
            try {
                await VirtuoFulfillmentService.handleTimeout(order, bot);
                updated++;
                notified++;
                timedOut++;
            } catch (e) {
                logger.warn('[Virtuo:monitor] timeout falhou', { id: order.id, detail: e.message });
            }
            continue;
        }
        try {
            const r = await VirtuoFulfillmentService.pollActivation(order, bot);
            if (r.updated) updated++;
            if (r.notified) notified++;
        } catch (e) {
            logger.warn('[Virtuo:monitor] poll falhou', { id: order.id, detail: e.message });
        }
    }

    return { checked: open.length, updated, notified, timedOut };
}

module.exports = { runActivationMonitorJob };
