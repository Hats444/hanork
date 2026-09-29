'use strict';

/**
 * Persistência do offset Telegram + deduplicação + fila local de retry.
 * Usa kv_store (SQLite) — sem nova tabela/migration.
 */
const KV_LAST_ID = 'telegram:last_update_id';
const KV_PROCESSED = 'telegram:processed_ids';
const KV_RETRY_QUEUE = 'telegram:retry_queue';
const MAX_PROCESSED_IDS = Math.max(500, parseInt(process.env.TELEGRAM_DEDUP_CACHE_SIZE || '2000', 10));
const MAX_RETRY_QUEUE = Math.max(10, parseInt(process.env.TELEGRAM_RETRY_QUEUE_MAX || '100', 10));

function db() {
    return require('../../config/database-sqlite').connect();
}

function readJson(key, fallback) {
    try {
        const row = db().prepare('SELECT value FROM kv_store WHERE key=?').get(key);
        if (!row?.value) return fallback;
        return JSON.parse(row.value);
    } catch {
        return fallback;
    }
}

function writeJson(key, value) {
    db()
        .prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        )
        .run(key, JSON.stringify(value));
}

function readLastUpdateId() {
    try {
        const row = db().prepare('SELECT value FROM kv_store WHERE key=?').get(KV_LAST_ID);
        const n = parseInt(row?.value, 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
        return 0;
    }
}

function writeLastUpdateId(updateId) {
    const id = parseInt(updateId, 10);
    if (!Number.isFinite(id) || id <= 0) return;
    const prev = readLastUpdateId();
    if (id <= prev) return;
    db()
        .prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        )
        .run(KV_LAST_ID, String(id));
}

function getProcessedSet() {
    const arr = readJson(KV_PROCESSED, []);
    return new Set(Array.isArray(arr) ? arr.filter((x) => Number.isFinite(x)) : []);
}

function persistProcessedSet(set) {
    const arr = [...set].sort((a, b) => a - b);
    while (arr.length > MAX_PROCESSED_IDS) arr.shift();
    writeJson(KV_PROCESSED, arr);
}

function isProcessed(updateId) {
    const id = parseInt(updateId, 10);
    if (!Number.isFinite(id)) return false;
    return getProcessedSet().has(id);
}

function markProcessed(updateId) {
    const id = parseInt(updateId, 10);
    if (!Number.isFinite(id)) return;
    const set = getProcessedSet();
    set.add(id);
    persistProcessedSet(set);
    writeLastUpdateId(id);
}

function getRetryQueue() {
    const q = readJson(KV_RETRY_QUEUE, []);
    return Array.isArray(q) ? q : [];
}

function saveRetryQueue(queue) {
    writeJson(KV_RETRY_QUEUE, queue.slice(-MAX_RETRY_QUEUE));
}

function enqueueRetry(update, errMsg = '') {
    const id = update?.update_id;
    if (!Number.isFinite(id)) return false;
    const queue = getRetryQueue();
    if (queue.some((row) => row.update_id === id)) return false;
    queue.push({
        update_id: id,
        update,
        attempts: 0,
        lastError: String(errMsg || '').slice(0, 200),
        enqueuedAt: new Date().toISOString(),
    });
    saveRetryQueue(queue);
    return true;
}

function dequeueRetry(updateId) {
    const id = parseInt(updateId, 10);
    const queue = getRetryQueue().filter((row) => row.update_id !== id);
    saveRetryQueue(queue);
}

function bumpRetryAttempt(updateId, errMsg) {
    const id = parseInt(updateId, 10);
    const queue = getRetryQueue();
    const row = queue.find((r) => r.update_id === id);
    if (!row) return null;
    row.attempts += 1;
    row.lastError = String(errMsg || '').slice(0, 200);
    row.lastAttemptAt = new Date().toISOString();
    saveRetryQueue(queue);
    return row;
}

function getStats() {
    const queue = getRetryQueue();
    return {
        lastUpdateId: readLastUpdateId(),
        processedCached: getProcessedSet().size,
        retryQueueSize: queue.length,
        retryPending: queue.filter((r) => r.attempts < maxRetryAttempts()).length,
    };
}

function maxRetryAttempts() {
    return Math.max(1, parseInt(process.env.TELEGRAM_RETRY_MAX_ATTEMPTS || '5', 10));
}

function telegramOffsetForRecovery() {
    const last = readLastUpdateId();
    return last > 0 ? last + 1 : 0;
}

module.exports = {
    KV_LAST_ID,
    readLastUpdateId,
    writeLastUpdateId,
    isProcessed,
    markProcessed,
    getRetryQueue,
    enqueueRetry,
    dequeueRetry,
    bumpRetryAttempt,
    getStats,
    maxRetryAttempts,
    telegramOffsetForRecovery,
};
