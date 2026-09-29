'use strict';

const SmmConfig = require('../smmConfig');

const memBuckets = new Map();

function pruneMem() {
    const now = Date.now();
    for (const [k, v] of memBuckets) {
        if (v.expires < now) memBuckets.delete(k);
    }
}

async function checkSmmRate(stateManager, telegramId, action, options = {}) {
    const max = options.max ?? SmmConfig.rateLimitMax;
    const windowSec = options.windowSec ?? SmmConfig.rateLimitWindowSec;
    const tid = String(telegramId);
    if (!tid || !action) return { allowed: true };

    const compositeKey = `smm_rl:${tid}:${action}`;

    if (stateManager?._redisState?.incrby) {
        try {
            const count = await stateManager._redisState.incrby('smm_rl', `${tid}:${action}`, 1, windowSec);
            return {
                allowed: count <= max,
                count,
                remaining: Math.max(0, max - count),
            };
        } catch (_) { /* fallback mem */ }
    }

    pruneMem();
    const now = Date.now();
    const entry = memBuckets.get(compositeKey);
    if (!entry || entry.expires < now) {
        memBuckets.set(compositeKey, { count: 1, expires: now + windowSec * 1000 });
        return { allowed: true, count: 1, remaining: max - 1 };
    }
    entry.count += 1;
    return {
        allowed: entry.count <= max,
        count: entry.count,
        remaining: Math.max(0, max - entry.count),
    };
}

module.exports = { checkSmmRate };
