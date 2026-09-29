'use strict';

/**
 * Dedup de webhook MP via Redis (P5-2) — coordena múltiplas instâncias Hanork.
 * Camada entre memória (por processo) e SQLite processed_webhooks.
 */
const RETENTION_SEC = 24 * 60 * 60;
const KEY_PREFIX = 'hanork:mp_wh_dedup:';

/** @type {import('ioredis').default | null} */
let _testRedis = null;

function isRedisDedupEnabled() {
    return process.env.MP_WEBHOOK_REDIS_DEDUP !== '0';
}

function dedupKey(paymentId) {
    return `${KEY_PREFIX}${String(paymentId)}`;
}

function getRedisClient() {
    if (_testRedis) return _testRedis;
    try {
        const rs = require('../state').getRedisState();
        if (rs && typeof rs._redisOperational === 'function' && rs._redisOperational()) {
            return rs.redis;
        }
        if (rs?.redis && !rs.useFallback) return rs.redis;
    } catch { /* sem Redis */ }
    return null;
}

async function hasRedis(paymentId) {
    if (!isRedisDedupEnabled()) return false;
    const redis = getRedisClient();
    if (!redis) return false;
    try {
        return (await redis.exists(dedupKey(paymentId))) === 1;
    } catch {
        return false;
    }
}

/** SET NX EX — retorna true se esta instância ganhou o claim. */
async function tryClaimRedis(paymentId) {
    if (!isRedisDedupEnabled()) return true;
    const redis = getRedisClient();
    if (!redis) return true;
    try {
        const res = await redis.set(dedupKey(paymentId), '1', 'EX', RETENTION_SEC, 'NX');
        return res === 'OK';
    } catch {
        return true;
    }
}

async function markRedis(paymentId) {
    if (!isRedisDedupEnabled()) return;
    const redis = getRedisClient();
    if (!redis) return;
    try {
        await redis.setex(dedupKey(paymentId), RETENTION_SEC, '1');
    } catch { /* degrade */ }
}

async function releaseRedisClaim(paymentId) {
    if (!isRedisDedupEnabled()) return;
    const redis = getRedisClient();
    if (!redis) return;
    try {
        await redis.del(dedupKey(paymentId));
    } catch { /* ignore */ }
}

module.exports = {
    isRedisDedupEnabled,
    hasRedis,
    tryClaimRedis,
    markRedis,
    releaseRedisClaim,
    RETENTION_SEC,
    KEY_PREFIX,
    /** @internal testes */
    _setTestRedis(client) {
        _testRedis = client;
    },
};
