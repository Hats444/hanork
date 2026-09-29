'use strict';

/** Dedup em memória — primeira linha de defesa do webhook MP (legado bot.js) */
const processedPaymentIds = new Map();
const dedupMetrics = { memory: 0, db: 0, redis: 0, delivered: 0 };

const redisDedup = require('./webhookRedisDedup');

const RETENTION_MS = 24 * 60 * 60 * 1000;

function has(paymentId) {
    return processedPaymentIds.has(String(paymentId));
}

function markProcessed(paymentId, timestamp = Date.now()) {
    processedPaymentIds.set(String(paymentId), timestamp);
}

function recordMemoryDedup() {
    dedupMetrics.memory++;
}

function recordDbDedup() {
    dedupMetrics.db++;
}

function recordRedisDedup() {
    dedupMetrics.redis++;
}

function recordDeliveredDedup() {
    dedupMetrics.delivered++;
}

function isDbDedupEnabled() {
    return process.env.MP_WEBHOOK_DB_DEDUP !== '0';
}

function hasDb(prisma, paymentId) {
    if (!isDbDedupEnabled() || !prisma?.processedWebhook) return false;
    return prisma.processedWebhook.isProcessed(paymentId);
}

function markDb(prisma, paymentId, orderId) {
    if (!isDbDedupEnabled() || !prisma?.processedWebhook) return;
    prisma.processedWebhook.markProcessed(paymentId, orderId ?? null);
}

/**
 * Remove IDs >24h e emite métricas horárias (comportamento legado).
 */
function runWebhookDedupCleanup(log) {
    const cutoff = Date.now() - RETENTION_MS;
    let cleaned = 0;
    for (const [pid, ts] of processedPaymentIds) {
        if (ts < cutoff) {
            processedPaymentIds.delete(pid);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        log.debug(`[DEDUP] Limpos ${cleaned} IDs antigos, restantes: ${processedPaymentIds.size}`);
    }
    if (dedupMetrics.memory + dedupMetrics.db + dedupMetrics.redis > 0) {
        log.info(
            `[DEDUP] Métricas: memory=${dedupMetrics.memory}, redis=${dedupMetrics.redis}, db=${dedupMetrics.db}, delivered=${dedupMetrics.delivered}`
        );
        dedupMetrics.memory = 0;
        dedupMetrics.db = 0;
        dedupMetrics.redis = 0;
        dedupMetrics.delivered = 0;
    }
}

module.exports = {
    has,
    markProcessed,
    hasDb,
    markDb,
    isDbDedupEnabled,
    isRedisDedupEnabled: redisDedup.isRedisDedupEnabled,
    hasRedis: redisDedup.hasRedis,
    tryClaimRedis: redisDedup.tryClaimRedis,
    markRedis: redisDedup.markRedis,
    releaseRedisClaim: redisDedup.releaseRedisClaim,
    runWebhookDedupCleanup,
    recordMemoryDedup,
    recordDbDedup,
    recordRedisDedup,
    recordDeliveredDedup,
    dedupMetrics,
    RETENTION_MS,
    /** @internal testes */
    _processedPaymentIds: processedPaymentIds,
};
