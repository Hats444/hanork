'use strict';

const SmmStatusService = require('../services/statusService');
const SmmConfig = require('../smmConfig');
const { runStuckFulfillRecoveryJob } = require('./stuckFulfillRecoveryJob');
const logger = require('../../../config/logger');

const POLL_DELAY_MS = 150;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function runOrderMonitorJob(bot) {
    const open = SmmStatusService.listOpen(SmmConfig.orderMonitorBatchSize);
    let updated = 0;
    let notified = 0;

    for (const order of open) {
        try {
            const r = await SmmStatusService.pollOrder(order, bot);
            if (r.updated) updated++;
            if (r.notified) notified++;
        } catch (e) {
            logger.warn('[SMM:monitor] poll falhou', { id: order.id, detail: e.message });
        }
        if (open.length > 1) await sleep(POLL_DELAY_MS);
    }

    let stuck = { checked: 0, recovered: 0, skipped: 0 };
    try {
        stuck = await runStuckFulfillRecoveryJob(bot);
    } catch (e) {
        logger.warn('[SMM:monitor] stuck recovery falhou', { detail: e.message });
    }

    return { checked: open.length, updated, notified, stuck };
}

module.exports = { runOrderMonitorJob, POLL_DELAY_MS };
