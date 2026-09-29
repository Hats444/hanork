'use strict';

const { logSchedulerOn } = require('./cronBootLog');
const { runSyncServicesJob } = require('../../modules/smm/jobs/syncServicesJob');
const SmmConfig = require('../../modules/smm/smmConfig');
const adminOpsDigest = require('../../services/adminOpsDigest');

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 5 * 60 * 1000;

let running = false;

async function runSmmCatalogSyncCycle(deps) {
    if (running) {
        deps.log?.info?.('[SMM:CRON] Catalog sync skip — ciclo anterior em andamento');
        return { skipped: true };
    }
    running = true;
    try {
        const result = await runSyncServicesJob({ source: 'auto', syncType: 'scheduled' });
        if (result.ok) {
            deps.log?.info?.('[SMM:CRON] Catalog sync OK', {
                processed: result.total_processed,
                created: result.created_count,
                updated: result.updated_count,
                removed: result.removed_count,
            });
        } else {
            deps.log?.warn?.('[SMM:CRON] Catalog sync falhou', { error: result.error });
        }
        adminOpsDigest.record('catalog_sync', result);
        return result;
    } finally {
        running = false;
    }
}

function startSmmCatalogSyncScheduler(deps, options = {}) {
    const intervalMs = options.intervalMs ?? SmmConfig.syncIntervalMs ?? DEFAULT_INTERVAL_MS;
    logSchedulerOn(deps.log, '[CRON] SMM catalog sync ON', { intervalMs, initialDelayMs: INITIAL_DELAY_MS });

    const tick = async () => {
        try {
            await runSmmCatalogSyncCycle(deps);
        } catch (e) {
            deps.log?.error?.('[SMM:CRON] Catalog sync erro:', e.message);
        }
    };

    const initial = setTimeout(() => {
        tick();
        setInterval(tick, intervalMs);
    }, INITIAL_DELAY_MS);

    return initial;
}

module.exports = {
    runSmmCatalogSyncCycle,
    startSmmCatalogSyncScheduler,
    DEFAULT_INTERVAL_MS,
};
