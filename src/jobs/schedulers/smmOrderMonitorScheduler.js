'use strict';

const { logSchedulerOn } = require('./cronBootLog');
const { runOrderMonitorJob } = require('../../modules/smm/jobs/orderMonitorJob');
const SmmConfig = require('../../modules/smm/smmConfig');
const adminOpsDigest = require('../../services/adminOpsDigest');

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const INITIAL_DELAY_MS = 60 * 1000;

let running = false;

async function runSmmOrderMonitorCycle(deps) {
    if (running) {
        deps.log?.info?.('[SMM:CRON] Order monitor skip — ciclo anterior em andamento');
        return { skipped: true };
    }
    running = true;
    try {
        const bot = deps.bot || global.botInstance;
        const result = await runOrderMonitorJob(bot);
        if (result.checked > 0) {
            deps.log?.info?.('[SMM:CRON] Order monitor', result);
        }
        adminOpsDigest.record('order_monitor', result);
        return result;
    } finally {
        running = false;
    }
}

function startSmmOrderMonitorScheduler(deps, options = {}) {
    const intervalMs = options.intervalMs ?? SmmConfig.orderMonitorIntervalMs ?? DEFAULT_INTERVAL_MS;
    logSchedulerOn(deps.log, '[CRON] SMM order monitor ON', { intervalMs, initialDelayMs: INITIAL_DELAY_MS });

    const tick = async () => {
        try {
            await runSmmOrderMonitorCycle(deps);
        } catch (e) {
            deps.log?.error?.('[SMM:CRON] Order monitor erro:', e.message);
        }
    };

    const initial = setTimeout(() => {
        tick();
        setInterval(tick, intervalMs);
    }, INITIAL_DELAY_MS);

    return initial;
}

module.exports = {
    runSmmOrderMonitorCycle,
    startSmmOrderMonitorScheduler,
    DEFAULT_INTERVAL_MS,
};
