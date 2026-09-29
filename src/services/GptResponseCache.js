'use strict';

const { getRedisState } = require('../modules/state');

const NS = 'gpt';
const MAX_MEMORY_ENTRIES = 400;
const _memory = new Map();

function isRedisCacheEnabled() {
    const v = String(process.env.ZEROTWO_AI_REDIS_CACHE || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

function ttlSecondsFromMs(ms) {
    return Math.max(60, Math.ceil(ms / 1000));
}

function trimMemory() {
    if (_memory.size <= MAX_MEMORY_ENTRIES) return;
    let oldestK = null;
    let oldestT = Infinity;
    for (const [k, v] of _memory) {
        if (v.at < oldestT) {
            oldestT = v.at;
            oldestK = k;
        }
    }
    if (oldestK) _memory.delete(oldestK);
}

function memoryGet(key, ttlMs) {
    const row = _memory.get(key);
    if (!row) return null;
    if (Date.now() - row.at > ttlMs) {
        _memory.delete(key);
        return null;
    }
    return row.value;
}

async function redisGet(key) {
    if (!isRedisCacheEnabled()) return null;
    try {
        const row = await getRedisState().get(NS, key);
        if (!row || row.value == null) return null;
        return row;
    } catch {
        return null;
    }
}

function redisSet(key, row, ttlMs) {
    if (!isRedisCacheEnabled()) return;
    getRedisState()
        .set(NS, key, row, ttlSecondsFromMs(ttlMs))
        .catch(() => {});
}

function redisDelete(key) {
    if (!isRedisCacheEnabled()) return;
    getRedisState()
        .delete(NS, String(key))
        .catch(() => {});
}

function redisDeleteByPrefix(prefix) {
    if (!isRedisCacheEnabled()) return;
    getRedisState()
        .keys(NS)
        .then((keys) => {
            const hits = keys.filter((k) => k.startsWith(prefix));
            return Promise.all(hits.map((k) => getRedisState().delete(NS, k)));
        })
        .catch(() => {});
}

/**
 * Lê cache IA: Redis primeiro (se habilitado), depois memória local.
 */
async function get(key, ttlMs) {
    const row = await redisGet(key);
    if (row) {
        _memory.set(key, row);
        return row.value;
    }
    return memoryGet(key, ttlMs);
}

/**
 * Dual-write: memória + Redis (fire-and-forget).
 */
function set(key, value, ttlMs) {
    const row = { at: Date.now(), value };
    _memory.set(key, row);
    trimMemory();
    redisSet(key, row, ttlMs);
}

function remove(key) {
    _memory.delete(String(key));
    redisDelete(key);
}

function removeByPrefix(prefix) {
    const p = String(prefix);
    for (const k of _memory.keys()) {
        if (k.startsWith(p)) _memory.delete(k);
    }
    redisDeleteByPrefix(p);
}

function memorySize() {
    return _memory.size;
}

module.exports = {
    get,
    set,
    remove,
    removeByPrefix,
    isRedisCacheEnabled,
    memorySize,
};
