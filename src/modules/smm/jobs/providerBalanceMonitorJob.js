'use strict';

const logger = require('../../../config/logger');
const { runBalanceMonitorCycle } = require('../services/providerBalanceService');

async function runProviderBalanceMonitorJob(bot) {
    try {
        const result = await runBalanceMonitorCycle(bot);
        if (result.notified) {
            logger.info('[SMM:balance] monitor alerta', {
                level: result.level,
                balance: result.balance,
                kind: result.kind,
            });
        }
        return result;
    } catch (e) {
        logger.error('[SMM:balance] monitor erro', { detail: e.message });
        return { ok: false, error: e.message };
    }
}

module.exports = { runProviderBalanceMonitorJob };
