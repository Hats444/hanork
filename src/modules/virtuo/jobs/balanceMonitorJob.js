'use strict';

const VirtuoBalanceService = require('../services/virtuoBalanceService');

async function runBalanceMonitorJob(bot) {
    return VirtuoBalanceService.runBalanceMonitorCycle(bot);
}

module.exports = { runBalanceMonitorJob };
