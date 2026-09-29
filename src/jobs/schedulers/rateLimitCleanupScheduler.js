'use strict';

const { logSchedulerOn } = require('./cronBootLog');

const DEFAULT_COMMAND_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_HTTP_INTERVAL_MS = 5 * 60 * 1000;
/** Idade máxima de entrada no mapa HTTP (2 min — igual ao legado em bot.js) */
const DEFAULT_HTTP_ENTRY_MAX_AGE_MS = 2 * 60 * 1000;

function runCommandLimiterCleanup(commandLimiter) {
    if (commandLimiter && typeof commandLimiter.cleanup === 'function') {
        commandLimiter.cleanup();
    }
    return { ok: true };
}

function runHttpRateMapCleanup(httpRateMap, maxAgeMs = DEFAULT_HTTP_ENTRY_MAX_AGE_MS) {
    if (!httpRateMap || typeof httpRateMap.entries !== 'function') {
        return { removed: 0 };
    }
    const now = Date.now();
    let removed = 0;
    for (const [k, v] of httpRateMap) {
        if (now - v.ts > maxAgeMs) {
            httpRateMap.delete(k);
            removed++;
        }
    }
    return { removed };
}

function startCommandLimiterCleanupScheduler(deps, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_COMMAND_INTERVAL_MS;
    logSchedulerOn(deps.log, '[CRON] Command limiter cleanup ON', { intervalMs });

    return setInterval(() => {
        try {
            runCommandLimiterCleanup(deps.commandLimiter);
        } catch (e) {
            deps.log.error('[CRON] Command limiter cleanup:', e.message);
        }
    }, intervalMs);
}

function startHttpRateMapCleanupScheduler(deps, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_HTTP_INTERVAL_MS;
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_HTTP_ENTRY_MAX_AGE_MS;
    logSchedulerOn(deps.log, '[CRON] HTTP rate map cleanup ON', { intervalMs, maxAgeMs });

    return setInterval(() => {
        try {
            runHttpRateMapCleanup(deps.httpRateMap, maxAgeMs);
        } catch (e) {
            deps.log.error('[CRON] HTTP rate map cleanup:', e.message);
        }
    }, intervalMs);
}

module.exports = {
    runCommandLimiterCleanup,
    runHttpRateMapCleanup,
    startCommandLimiterCleanupScheduler,
    startHttpRateMapCleanupScheduler,
    DEFAULT_COMMAND_INTERVAL_MS,
    DEFAULT_HTTP_INTERVAL_MS,
    DEFAULT_HTTP_ENTRY_MAX_AGE_MS,
};
