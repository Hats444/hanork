'use strict';

const crypto = require('crypto');
const logger = require('../config/logger');
const GptProviderPool = require('./GptProviderPool');
const GptResponseCache = require('./GptResponseCache');

const CONCURRENCY = Math.min(
    2,
    Math.max(1, Number(process.env.ZEROTWO_AI_CONCURRENCY) || 1)
);
const MIN_GAP_MS = Math.max(800, Number(process.env.ZEROTWO_AI_MIN_GAP_MS) || 2800);
const CACHE_TTL_MS = Math.max(60000, Number(process.env.ZEROTWO_AI_CACHE_TTL_MS) || 6 * 60 * 60 * 1000);
const FAIL_CACHE_TTL_MS = Math.max(30000, Number(process.env.ZEROTWO_AI_FAIL_CACHE_TTL_MS) || 5 * 60 * 1000);
const RATE_LIMIT_COOLDOWN_MS = Math.max(
    15000,
    Number(process.env.ZEROTWO_AI_429_COOLDOWN_MS) || 120000
);
const MAX_RETRIES = Math.min(4, Math.max(0, Number(process.env.ZEROTWO_AI_MAX_RETRIES) || 2));
const BOOT_GUARD_MS = Math.max(0, Number(process.env.ZEROTWO_AI_BOOT_GUARD_MS) || 120000);

let _bootCompleteAt = 0;
let _rateLimitedUntil = 0;
let _active = 0;
let _lastDoneAt = 0;
/** @type {{ run: () => void, channel: 'wa'|'tg' }[]} */
const _waiters = [];
const _failCache = new Map();
/** @type {Map<string|number, Promise<string>>} */
const _productInFlight = new Map();

const _metrics = {
    success: 0,
    fail: 0,
    timeout: 0,
    cacheHit: 0,
    rateLimited: 0,
    bootSkipped: 0,
    totalLatencyMs: 0,
    requests: 0,
};

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function fingerprint(query) {
    return crypto.createHash('sha256').update(String(query || '')).digest('hex').slice(0, 32);
}

function cacheKeyFor({ query, productId, cacheKey }) {
    if (cacheKey) return String(cacheKey);
    if (productId != null) return `product:${productId}:${fingerprint(query)}`;
    return fingerprint(query);
}

function setBootComplete() {
    _bootCompleteAt = Date.now();
}

function isBootPhase() {
    return !_bootCompleteAt;
}

function isBootGuardActive() {
    if (!_bootCompleteAt) return true;
    return Date.now() - _bootCompleteAt < BOOT_GUARD_MS;
}

function bootGuardRemainingMs() {
    if (!_bootCompleteAt) return BOOT_GUARD_MS;
    const left = BOOT_GUARD_MS - (Date.now() - _bootCompleteAt);
    return left > 0 ? left : 0;
}

function isRateLimited() {
    return Date.now() < _rateLimitedUntil;
}

function getRateLimitedUntil() {
    return _rateLimitedUntil;
}

function markRateLimited(ms = RATE_LIMIT_COOLDOWN_MS, retryAfterSec = null) {
    const extra = retryAfterSec ? retryAfterSec * 1000 : ms;
    _rateLimitedUntil = Math.max(_rateLimitedUntil, Date.now() + extra);
    _metrics.rateLimited++;
    logger.info('[ZeroTwo AI] rate limit — cooldown (template/fila até liberar)', {
        sec: Math.round((extra || ms) / 1000),
        retryAfter: retryAfterSec || null,
    });
}

async function cacheGet(key) {
    return GptResponseCache.get(key, CACHE_TTL_MS);
}

function cacheSet(key, value) {
    GptResponseCache.set(key, value, CACHE_TTL_MS);
}

function failBlocked(key) {
    const t = _failCache.get(key);
    return t != null && Date.now() - t < FAIL_CACHE_TTL_MS;
}

function failMark(key) {
    _failCache.set(key, Date.now());
}

function countWaitersByChannel(channel) {
    return _waiters.filter((w) => w.channel === channel).length;
}

function enqueueWaiter(attempt, channel = 'tg') {
    const entry = { run: attempt, channel: channel === 'wa' ? 'wa' : 'tg' };
    if (entry.channel === 'wa') {
        const firstTg = _waiters.findIndex((w) => w.channel !== 'wa');
        if (firstTg === -1) _waiters.push(entry);
        else _waiters.splice(firstTg, 0, entry);
    } else {
        _waiters.push(entry);
    }
}

function releaseSlot() {
    _active = Math.max(0, _active - 1);
    _lastDoneAt = Date.now();
    const waIdx = _waiters.findIndex((w) => w.channel === 'wa');
    const next = waIdx >= 0 ? _waiters.splice(waIdx, 1)[0] : _waiters.shift();
    if (next?.run) setImmediate(next.run);
}

async function acquireSlot(channel = 'tg') {
    const ch = channel === 'wa' ? 'wa' : 'tg';
    await new Promise((resolve) => {
        const attempt = () => {
            if (_active >= CONCURRENCY) {
                enqueueWaiter(attempt, ch);
                return;
            }
            const gap = Math.max(0, MIN_GAP_MS - (Date.now() - _lastDoneAt));
            if (gap > 0) {
                setTimeout(attempt, gap);
                return;
            }
            _active++;
            resolve();
        };
        attempt();
    });
}

/** Telegram só usa IA quando a fila está livre e não há demanda WA pendente. */
function canUseAiForTelegram() {
    if (isBootPhase() || isBootGuardActive() || isRateLimited()) return false;
    if (countWaitersByChannel('wa') > 0) return false;
    if (_active > 0 || _waiters.length > 0 || _productInFlight.size > 0) return false;
    return true;
}

async function executeRequestOnce({ apiBase, apiKey, query, timeout, rotateIndex = 0, productId = null }) {
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const r = await GptProviderPool.executeWithFailover({
                apiBase,
                apiKey,
                query,
                timeout,
                rotateIndex,
                productId,
            });
            return r;
        } catch (e) {
            lastErr = e;
            const retryAfter = GptProviderPool.parseRetryAfter(e?.response?.headers);
            if (GptProviderPool.is429Error(e, e?.response?.data, e?.response?.status, e?.response?.headers)) {
                markRateLimited(RATE_LIMIT_COOLDOWN_MS, retryAfter);
                throw e;
            }
            const isTimeout = e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message || '');
            if (isTimeout) _metrics.timeout++;
            if (attempt < MAX_RETRIES) {
                const backoff = Math.min(30000, 800 * Math.pow(2, attempt));
                await sleep(backoff);
                continue;
            }
            throw e;
        }
    }
    throw lastErr || new Error('GPT request failed');
}

/**
 * Executa GET na API GPT com fila, cache, pool de provedores e métricas.
 */
async function executeGptGet({
    query,
    timeout,
    apiBase,
    apiKey,
    skipCache = false,
    productId = null,
    cacheKey = null,
    allowBoot = false,
    channel = 'tg',
}) {
    if (!apiKey) throw new Error('API_KEY_ZEROTWO não configurada no .env');

    const key = cacheKeyFor({ query, productId, cacheKey });

    if (!allowBoot && isBootGuardActive()) {
        _metrics.bootSkipped++;
        throw new Error('GPT bloqueado durante boot guard — use template ou aguarde');
    }

    if (failBlocked(key)) {
        throw new Error('GPT: mesma consulta em cooldown após falha recente');
    }

    if (!skipCache) {
        const hit = await cacheGet(key);
        if (hit) {
            _metrics.cacheHit++;
            logger.info('[ZeroTwo AI] cache hit', { key, productId });
            return hit;
        }
    }

    if (isRateLimited()) {
        throw new Error('GPT em cooldown após rate limit — aguarde antes de nova tentativa');
    }

    if (productId != null && _productInFlight.has(productId)) {
        return _productInFlight.get(productId);
    }

    const run = async () => {
        await acquireSlot(channel);
        try {
            while (isRateLimited()) {
                await sleep(400);
            }

            const t0 = Date.now();
            _metrics.requests++;
            const r = await executeRequestOnce({
                apiBase,
                apiKey,
                query,
                timeout,
                rotateIndex: productId ?? 0,
                productId,
            });
            const body = r.body;
            if (!skipCache) cacheSet(key, body);
            _failCache.delete(key);
            _metrics.success++;
            _metrics.totalLatencyMs += r.ms || Date.now() - t0;
            logger.info('[ZeroTwo AI] ok', {
                provider: r.providerLabel,
                ms: r.ms,
                productId: productId || null,
                channel,
            });
            return body;
        } catch (e) {
            _metrics.fail++;
            failMark(key);
            throw e;
        } finally {
            releaseSlot();
        }
    };

    const promise = run().catch((e) => {
        throw e;
    });
    if (productId != null) {
        _productInFlight.set(productId, promise);
        promise.catch(() => {}).finally(() => {
            if (_productInFlight.get(productId) === promise) {
                _productInFlight.delete(productId);
            }
        });
    }
    return promise;
}

function invalidateCache(key) {
    if (key) GptResponseCache.remove(String(key));
}

function invalidateProductCache(productId) {
    if (productId == null) return;
    GptResponseCache.remove(`promo:stable:v2:${productId}`);
    GptResponseCache.remove(`promo:stable:${productId}`);
    GptResponseCache.removeByPrefix(`product:${productId}:`);
    GptResponseCache.removeByPrefix(`promo:${productId}:`);
}
function getStats() {
    const avgMs =
        _metrics.success > 0 ? Math.round(_metrics.totalLatencyMs / _metrics.success) : 0;
    return {
        active: _active,
        queue: _waiters.length,
        waPending: countWaitersByChannel('wa'),
        tgPending: countWaitersByChannel('tg'),
        cacheSize: GptResponseCache.memorySize(),
        redisCache: GptResponseCache.isRedisCacheEnabled(),
        productInFlight: _productInFlight.size,
        rateLimited: isRateLimited(),
        bootPhase: isBootPhase(),
        bootGuard: isBootGuardActive(),
        tgAiIdle: canUseAiForTelegram(),
        metrics: { ..._metrics, avgMs },
        providers: GptProviderPool.getProviderStats(),
    };
}

module.exports = {
    executeGptGet,
    setBootComplete,
    isBootPhase,
    isBootGuardActive,
    bootGuardRemainingMs,
    isRateLimited,
    canUseAiForTelegram,
    getRateLimitedUntil,
    markRateLimited,
    getStats,
    fingerprint,
    cacheKeyFor,
    invalidateCache,
    invalidateProductCache,
};
