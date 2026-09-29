'use strict';

const { logSchedulerOn } = require('./cronBootLog');

const DEFAULT_INTERVAL_MS = 20 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;

async function sweepRedisState(label, stateManager, now, sessionTtlMs, log) {
    if (!stateManager?.redis) return;
    try {
        const pattern = `${stateManager.namespace}:*`;
        const keys = await stateManager.redis.keys(pattern);
        for (const fullKey of keys) {
            try {
                const data = await stateManager.redis.get(fullKey);
                if (!data) continue;
                const value = JSON.parse(data);
                if (value && typeof value._ts === 'number' && now - value._ts > sessionTtlMs) {
                    await stateManager.redis.del(fullKey);
                    log.debug(`[CLEANUP] ${label}: removed expired key ${fullKey}`);
                }
            } catch {
                /* parse */
            }
        }
    } catch (err) {
        log.error(`[CLEANUP] ${label}:`, err.message);
    }
}

function sweepNativeMap(label, m, now, sessionTtlMs, log) {
    if (!m || !(m instanceof Map)) return;
    try {
        for (const [k, v] of m.entries()) {
            if (v && typeof v._ts === 'number' && now - v._ts > sessionTtlMs) m.delete(k);
        }
    } catch (err) {
        log.error(`[CLEANUP] Native Map ${label}:`, err.message);
    }
}

/**
 * @param {object} deps
 * @param {Function} deps.getNativeMaps — () => Record<string, Map>
 * @param {Function} deps.getRedisWrapped — () => Record<string, object>
 */
async function runSessionStateSweep(deps, options = {}) {
    const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    const { prisma, log } = deps;
    const now = Date.now();

    const native = deps.getNativeMaps?.() || {};
    for (const [label, m] of Object.entries(native)) {
        sweepNativeMap(label, m, now, sessionTtlMs, log);
    }

    const redisWrapped = deps.getRedisWrapped?.() || {};
    for (const [label, sm] of Object.entries(redisWrapped)) {
        await sweepRedisState(label, sm, now, sessionTtlMs, log);
    }

    let cleaned = 0;
    try {
        cleaned = await prisma.session.cleanupExpired();
        if (cleaned > 0) log.info(`[CLEANUP] Sessões expiradas removidas: ${cleaned}`);
    } catch (e) {
        log.error('Erro ao limpar sessões expiradas:', e.message);
    }
    return { dbSessionsCleaned: cleaned };
}

function startSessionStateSweepScheduler(deps, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    logSchedulerOn(deps.log, '[CRON] Session state sweep ON', {
        intervalMs,
        sessionTtlMs: options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
    });

    return setInterval(async () => {
        try {
            await runSessionStateSweep(deps, options);
        } catch (e) {
            deps.log.error('[CLEANUP] Erro ao varrer maps de sessão:', e.message);
        }
    }, intervalMs);
}

module.exports = {
    runSessionStateSweep,
    startSessionStateSweepScheduler,
    DEFAULT_INTERVAL_MS,
    DEFAULT_SESSION_TTL_MS,
};
