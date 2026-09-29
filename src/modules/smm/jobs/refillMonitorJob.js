'use strict';

const SmmRefillService = require('../services/refillService');
const SmmConfig = require('../smmConfig');
const logger = require('../../../config/logger');

const POLL_DELAY_MS = 200;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function runRefillMonitorJob(bot) {
    const pending = SmmRefillService.listPending(SmmConfig.refillMonitorBatchSize);
    let updated = 0;

    for (const order of pending) {
        try {
            const r = await SmmRefillService.pollRefill(order, bot);
            if (r.updated) updated++;
        } catch (e) {
            logger.warn('[SMM:refill-monitor] poll falhou', { id: order.id, detail: e.message });
        }
        if (pending.length > 1) await sleep(POLL_DELAY_MS);
    }

    return { checked: pending.length, updated };
}

module.exports = { runRefillMonitorJob, POLL_DELAY_MS };
