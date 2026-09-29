'use strict';

const { logSchedulerOn } = require('./cronBootLog');
const { runProviderBalanceMonitorJob } = require('../../modules/smm/jobs/providerBalanceMonitorJob');
const SmmConfig = require('../../modules/smm/smmConfig');
const adminOpsDigest = require('../../services/adminOpsDigest');

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const INITIAL_DELAY_MS = 90 * 1000;

let running = false;

async function runSmmProviderBalanceCycle(deps) {
    if (running) {
        deps.log?.info?.('[SMM:CRON] Balance monitor skip — ciclo anterior em andamento');
        return { skipped: true };
    }
    running = true;
    try {
        const bot = deps.bot || global.botInstance;
        return await runProviderBalanceMonitorJob(bot);
    } finally {
        running = false;
    }
}

function startSmmProviderBalanceScheduler(deps, options = {}) {
    const intervalMs = options.intervalMs ?? SmmConfig.balanceMonitorIntervalMs ?? DEFAULT_INTERVAL_MS;
    logSchedulerOn(deps.log, '[CRON] SMM provider balance ON', {
        intervalMs,
        initialDelayMs: INITIAL_DELAY_MS,
        warn: SmmConfig.balanceWarnThreshold,
        critical: SmmConfig.balanceCriticalThreshold,
    });

    const tick = async () => {
        try {
            const result = await runSmmProviderBalanceCycle(deps);
            if (result?.notified || result?.balance != null) {
                deps.log?.info?.('[SMM:CRON] Balance monitor', {
                    balance: result.balance,
                    level: result.level,
                    notified: result.notified,
                });
            }
            if (result && !result.skipped) {
                adminOpsDigest.record('balance', result);
            }
        } catch (e) {
            deps.log?.error?.('[SMM:CRON] Balance monitor erro:', e.message);
        }
    };

    const initial = setTimeout(() => {
        tick();
        setInterval(tick, intervalMs);
    }, INITIAL_DELAY_MS);

    return initial;
}

module.exports = {
    runSmmProviderBalanceCycle,
    startSmmProviderBalanceScheduler,
    DEFAULT_INTERVAL_MS,
};
