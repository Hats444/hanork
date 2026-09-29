'use strict';

const { logSchedulerOn } = require('./cronBootLog');
const { runRefillMonitorJob } = require('../../modules/smm/jobs/refillMonitorJob');
const SmmConfig = require('../../modules/smm/smmConfig');
const adminOpsDigest = require('../../services/adminOpsDigest');

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const INITIAL_DELAY_MS = 2 * 60 * 1000;

let running = false;

async function runSmmRefillMonitorCycle(deps) {
    if (running) return { skipped: true };
    running = true;
    try {
        const bot = deps.bot || global.botInstance;
        const result = await runRefillMonitorJob(bot);
        if (result.checked > 0) {
            deps.log?.info?.('[SMM:CRON] Refill monitor', result);
        }
        adminOpsDigest.record('refill', result);
        return result;
    } finally {
        running = false;
    }
}

function startSmmRefillMonitorScheduler(deps, options = {}) {
    const intervalMs = options.intervalMs ?? SmmConfig.refillMonitorIntervalMs ?? DEFAULT_INTERVAL_MS;
    logSchedulerOn(deps.log, '[CRON] SMM refill monitor ON', { intervalMs, initialDelayMs: INITIAL_DELAY_MS });

    const tick = async () => {
        try {
            await runSmmRefillMonitorCycle(deps);
        } catch (e) {
            deps.log?.error?.('[SMM:CRON] Refill monitor erro:', e.message);
        }
    };

    const initial = setTimeout(() => {
        tick();
        setInterval(tick, intervalMs);
    }, INITIAL_DELAY_MS);

    return initial;
}

module.exports = {
    runSmmRefillMonitorCycle,
    startSmmRefillMonitorScheduler,
    DEFAULT_INTERVAL_MS,
};
