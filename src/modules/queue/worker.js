/**
 * Queue worker — registra processadores Bull
 */
'use strict';

const QueueService = require('./QueueService');
const jobs = require('./jobs');
const logger = require('../../config/logger');

let processorsRegistered = false;

function registerProcessors(bot) {
    if (processorsRegistered) {
        logger.warn('[QUEUE] Processors já registrados neste processo — skip');
        return;
    }
    processorsRegistered = true;
    global.botInstance = bot;

    const defs = [
        ['broadcast:telegram', 1, jobs.processTelegramBroadcast],
        ['broadcast:pv', 1, jobs.processPvPromoDelivery],
        ['broadcast:email', 1, jobs.processEmailBroadcast],
        ['delivery:products', 3, jobs.processDelivery],
        ['delivery:resend', 2, jobs.processResend],
        ['notification:abandoned', 1, jobs.processAbandonedCart],
        ['notification:pix', 1, jobs.processPixReminder],
        ['notification:giveaway', 1, jobs.processGiveawayWinner],
        ['notification:subscription', 1, jobs.processSubscriptionReminder],
        ['notification:admin', 2, jobs.processAdminNotify],
        ['report:daily', 1, jobs.processDailyReport],
        ['report:sales', 1, jobs.processSalesReport],
        ['ai:catalog', 1, jobs.processCatalogAi],
        ['smm:fulfill', 2, jobs.processSmmFulfill],
        ['virtuo:fulfill', 2, jobs.processVirtuoFulfill],
        ['wadv:campaign', 1, jobs.processWaDivCampaign],
    ];

    for (const [name, concurrency, handler] of defs) {
        try {
            QueueService.process(name, concurrency, handler);
        } catch (e) {
            logger.warn(`[QUEUE] skip ${name}: ${e.message}`);
        }
    }

    logger.info('[QUEUE] Processors registered', { count: defs.length });
}

module.exports = { registerProcessors };
