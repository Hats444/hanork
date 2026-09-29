'use strict';

const { logSchedulerOn } = require('./cronBootLog');
const { runServiceHealthMonitorJob } = require('../../modules/smm/jobs/serviceHealthJob');
const SmmConfig = require('../../modules/smm/smmConfig');
const adminOpsDigest = require('../../services/adminOpsDigest');

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 2 * 60 * 1000;

let running = false;

async function runSmmServiceHealthCycle(deps) {
    if (running) {
        deps.log?.info?.('[SMM:CRON] Service health skip — ciclo anterior em andamento');
        return { skipped: true };
    }
    running = true;
    try {
        const result = await runServiceHealthMonitorJob();
        return result;
    } finally {
        running = false;
    }
}

function startSmmServiceHealthScheduler(deps, options = {}) {
    const intervalMs = options.intervalMs ?? SmmConfig.healthMonitorIntervalMs ?? DEFAULT_INTERVAL_MS;
    logSchedulerOn(deps.log, '[CRON] SMM service health ON', { intervalMs, initialDelayMs: INITIAL_DELAY_MS });

    const tick = async () => {
        try {
            const result = await runSmmServiceHealthCycle(deps);
            if (result && !result.skipped) {
                deps.log?.info?.('[SMM:CRON] Service health', result);
                adminOpsDigest.record('service_health', result);
            }
        } catch (e) {
            deps.log?.error?.('[SMM:CRON] Service health erro:', e.message);
        }
    };

    const initial = setTimeout(() => {
        tick();
        setInterval(tick, intervalMs);
    }, INITIAL_DELAY_MS);

    return initial;
}

module.exports = {
    runSmmServiceHealthCycle,
    startSmmServiceHealthScheduler,
    DEFAULT_INTERVAL_MS,
};
