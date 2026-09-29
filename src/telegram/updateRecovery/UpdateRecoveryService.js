'use strict';

const logger = require('../../config/logger');
const store = require('./UpdateRecoveryStore');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRecoveryEnabled() {
    const v = String(process.env.TELEGRAM_UPDATE_RECOVERY ?? '1').trim().toLowerCase();
    return v !== '0' && v !== 'false';
}

function shouldDropPending() {
    return process.env.TELEGRAM_DROP_PENDING === '1';
}

function describeUpdate(update) {
    if (!update) return 'unknown';
    if (update.message?.text) return `message "${String(update.message.text).slice(0, 40)}"`;
    if (update.callback_query?.data) return `callback "${String(update.callback_query.data).slice(0, 40)}"`;
    if (update.message) return 'message';
    if (update.callback_query) return 'callback_query';
    if (update.chat_member) return 'chat_member';
    if (update.my_chat_member) return 'my_chat_member';
    if (update.channel_post) return 'channel_post';
    return Object.keys(update).filter((k) => k !== 'update_id').join(',') || 'update';
}

async function processUpdateWithRetry(bot, update, { phase = 'live' } = {}) {
    const updateId = update?.update_id;
    if (!Number.isFinite(updateId)) return { ok: false, reason: 'no_update_id' };

    if (store.isProcessed(updateId)) {
        return { ok: true, skipped: true, reason: 'dedup' };
    }

    const maxAttempts = Math.max(1, parseInt(process.env.TELEGRAM_UPDATE_RETRY_ATTEMPTS || '3', 10));
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await bot.handleUpdate(update);
            store.markProcessed(updateId);
            store.dequeueRetry(updateId);
            return { ok: true, attempts: attempt };
        } catch (e) {
            lastErr = e;
            const msg = e?.description || e?.message || String(e);
            const retryable =
                e?.code === 'ECONNRESET' ||
                e?.code === 'ETIMEDOUT' ||
                e?.code === 'ENOTFOUND' ||
                /429|500|502|503|504|timeout|fetch/i.test(msg);

            logger.warn('[UpdateRecovery] falha ao processar update', {
                phase,
                updateId,
                attempt,
                maxAttempts,
                retryable,
                kind: describeUpdate(update),
                error: msg.slice(0, 180),
            });

            if (!retryable || attempt >= maxAttempts) break;
            await sleep(Math.min(8000, 400 * Math.pow(2, attempt - 1)));
        }
    }

    store.enqueueRetry(update, lastErr?.message || String(lastErr));
    return { ok: false, reason: 'failed', error: lastErr?.message };
}

/**
 * Drena fila local (updates que falharam em boot ou runtime).
 */
async function flushLocalRetryQueue(bot, { limit = 20 } = {}) {
    if (!isRecoveryEnabled()) return { processed: 0, failed: 0, remaining: 0 };

    const queue = store.getRetryQueue();
    if (!queue.length) return { processed: 0, failed: 0, remaining: 0 };

    let processed = 0;
    let failed = 0;
    const maxRetries = store.maxRetryAttempts();

    for (const row of queue.slice(0, limit)) {
        if (row.attempts >= maxRetries) {
            logger.error('[UpdateRecovery] update descartado após max retries', {
                updateId: row.update_id,
                attempts: row.attempts,
                lastError: row.lastError,
            });
            store.dequeueRetry(row.update_id);
            failed++;
            continue;
        }

        if (store.isProcessed(row.update_id)) {
            store.dequeueRetry(row.update_id);
            continue;
        }

        store.bumpRetryAttempt(row.update_id, '');
        const result = await processUpdateWithRetry(bot, row.update, { phase: 'retry-queue' });
        if (result.ok && !result.skipped) processed++;
        else if (!result.ok) failed++;
    }

    const remaining = store.getRetryQueue().length;
    if (processed || failed) {
        logger.info('[UpdateRecovery] fila local processada', { processed, failed, remaining });
    }
    return { processed, failed, remaining };
}

/**
 * Antes do bot.launch — busca updates pendentes na Telegram Bot API.
 * Limitação API: fila mantida ~24h; não há histórico além disso.
 */
async function recoverPendingUpdatesOnBoot(bot, telegram, { allowedUpdates = [] } = {}) {
    if (!isRecoveryEnabled()) {
        logger.info('[UpdateRecovery] desativado (TELEGRAM_UPDATE_RECOVERY=0)');
        return { recovered: 0, skipped: 0, failed: 0, batches: 0 };
    }

    if (shouldDropPending()) {
        logger.warn(
            '[UpdateRecovery] TELEGRAM_DROP_PENDING=1 — updates pendentes serão descartados pelo Telegram (sem drain)'
        );
        return { recovered: 0, skipped: 0, failed: 0, batches: 0, dropped: true };
    }

    let offset = store.telegramOffsetForRecovery();
    const maxBatches = Math.max(1, parseInt(process.env.TELEGRAM_RECOVERY_MAX_BATCHES || '50', 10));
    const limit = Math.min(100, Math.max(1, parseInt(process.env.TELEGRAM_RECOVERY_BATCH_SIZE || '100', 10)));

    let recovered = 0;
    let skipped = 0;
    let failed = 0;
    let batches = 0;

    logger.info('[UpdateRecovery] iniciando drain de updates pendentes', {
        offset,
        lastSavedUpdateId: store.readLastUpdateId(),
        retryQueue: store.getRetryQueue().length,
    });

    for (let b = 0; b < maxBatches; b++) {
        let updates = [];
        try {
            updates = await telegram.callApi('getUpdates', {
                offset,
                limit,
                timeout: 0,
                allowed_updates: allowedUpdates.length ? allowedUpdates : undefined,
            });
        } catch (e) {
            logger.warn('[UpdateRecovery] getUpdates falhou no boot', { offset, error: e.message });
            break;
        }

        if (!updates?.length) break;
        batches++;

        for (const update of updates) {
            offset = update.update_id + 1;
            if (store.isProcessed(update.update_id)) {
                skipped++;
                continue;
            }
            const result = await processUpdateWithRetry(bot, update, { phase: 'boot-drain' });
            if (result.ok && !result.skipped) recovered++;
            else if (result.skipped) skipped++;
            else failed++;
        }
    }

    if (offset > 0) {
        try {
            await telegram.callApi('getUpdates', { offset, limit: 1, timeout: 0 });
        } catch {
            /* confirma offset — falha não crítica */
        }
    }

    const queueResult = await flushLocalRetryQueue(bot, { limit: 30 });

    logger.info('[UpdateRecovery] boot drain concluído', {
        recovered,
        skipped,
        failed,
        batches,
        confirmedOffset: offset,
        lastUpdateId: store.readLastUpdateId(),
        retryQueueRemaining: queueResult.remaining,
    });

    return { recovered, skipped, failed, batches, queueResult };
}

/**
 * Middleware Telegraf — dedup + persistência + enqueue em falha.
 * Deve ser o PRIMEIRO middleware registrado no bot.
 */
function registerUpdateRecoveryMiddleware(bot) {
    if (!isRecoveryEnabled()) return;

    bot.use(async (ctx, next) => {
        const updateId = ctx.update?.update_id;
        if (!Number.isFinite(updateId)) return next();

        if (store.isProcessed(updateId)) {
            logger.info('[UpdateRecovery] dedup skip', { updateId });
            return;
        }

        if (process.env.TELEGRAM_UPDATE_TRACE !== '0') {
            logger.info('[TELEGRAM] update recebido', {
                updateId,
                uid: ctx.from?.id,
                kind: describeUpdate(ctx.update),
                chat: ctx.chat?.type,
            });
        }

        try {
            await next();
            store.markProcessed(updateId);
            store.dequeueRetry(updateId);
        } catch (e) {
            store.enqueueRetry(ctx.update, e?.message);
            throw e;
        }
    });
}

let _retryTimer = null;

function startRetryQueueScheduler(bot) {
    if (!isRecoveryEnabled() || _retryTimer) return;
    const intervalMs = Math.max(15000, parseInt(process.env.TELEGRAM_RETRY_INTERVAL_MS || '30000', 10));

    _retryTimer = setInterval(() => {
        flushLocalRetryQueue(bot, { limit: 8 }).catch((e) => {
            logger.warn('[UpdateRecovery] retry scheduler:', e.message);
        });
    }, intervalMs);
    if (_retryTimer.unref) _retryTimer.unref();

    logger.info('[UpdateRecovery] scheduler de retry ativo', { intervalMs });
}

function getRecoveryMetrics() {
    return {
        enabled: isRecoveryEnabled(),
        dropPending: shouldDropPending(),
        ...store.getStats(),
    };
}

module.exports = {
    isRecoveryEnabled,
    shouldDropPending,
    recoverPendingUpdatesOnBoot,
    flushLocalRetryQueue,
    processUpdateWithRetry,
    registerUpdateRecoveryMiddleware,
    startRetryQueueScheduler,
    getRecoveryMetrics,
};
