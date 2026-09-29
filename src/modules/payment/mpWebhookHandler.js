'use strict';

/**
 * Handler Mercado Pago — validação antes do ack, receipt durável (P5-1).
 */
const { isMpIp, validateMpSignature } = require('./mpWebhookSecurity');
const PaymentService = require('./PaymentService');
const SafeWebhookHandler = require('./SafeWebhookHandler');

const RECEIPT_PREFIX = 'mp_wh_pending:';

const TERMINAL_REASONS = new Set([
    'already_delivered',
    'already_paid',
    'order_cancelled',
    'amount_mismatch',
    'order_not_found',
    'already_processed',
]);

function isDurableAckEnabled() {
    return process.env.MP_WEBHOOK_DURABLE_ACK !== '0';
}

function isSyncAckEnabled() {
    return process.env.MP_WEBHOOK_SYNC_ACK === '1';
}

function receiptKey(paymentId) {
    return `${RECEIPT_PREFIX}${paymentId}`;
}

function persistReceipt(paymentId, body) {
    if (!isDurableAckEnabled()) return;
    try {
        const { connect } = require('../../config/database-sqlite');
        connect()
            .prepare(
                `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
            )
            .run(receiptKey(paymentId), JSON.stringify({ body, received_at: new Date().toISOString() }));
    } catch { /* não bloquear ack */ }
}

function clearReceipt(paymentId) {
    if (!isDurableAckEnabled()) return;
    try {
        const { connect } = require('../../config/database-sqlite');
        connect().prepare('DELETE FROM kv_store WHERE key = ?').run(receiptKey(paymentId));
    } catch { /* ignore */ }
}

function listPendingReceipts() {
    try {
        const { connect } = require('../../config/database-sqlite');
        return connect()
            .prepare(`SELECT key, value FROM kv_store WHERE key LIKE ?`)
            .all(`${RECEIPT_PREFIX}%`);
    } catch {
        return [];
    }
}

function clientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

/**
 * Valida IP + HMAC. Retorna { ok, status, reason }.
 */
function validateMpWebhookRequest(req) {
    const ip = clientIp(req);
    if (!isMpIp(req)) {
        return { ok: false, status: 403, reason: 'ip', ip };
    }
    if (!validateMpSignature(req)) {
        return { ok: false, status: 401, reason: 'hmac', ip };
    }
    return { ok: true, status: 200, ip };
}

/**
 * Processa um payment_id (fetch MP + SafeWebhookHandler).
 */
async function processMpPaymentWebhook(deps, paymentId) {
    const { bot, prisma, logger, webhookPaymentDedup } = deps;
    const pidStr = String(paymentId);

    if (webhookPaymentDedup.has(pidStr)) {
        webhookPaymentDedup.recordMemoryDedup();
        logger.warn(`Webhook duplicado ignorado (mem): payment_id ${pidStr}`);
        return { skipped: true, reason: 'memory_dedup' };
    }

    if (await webhookPaymentDedup.hasRedis(pidStr)) {
        webhookPaymentDedup.recordRedisDedup();
        webhookPaymentDedup.markProcessed(pidStr);
        logger.warn(`webhook_dedup_redis_hit payment_id=${pidStr}`);
        return { skipped: true, reason: 'redis_dedup' };
    }

    logger.webhook(pidStr, 'received');
    const paymentResolved = await PaymentService.getStatusForWebhook(pidStr);
    const payment = paymentResolved?.payment;
    if (!payment || payment.status !== 'approved') {
        return { skipped: true, reason: 'not_approved' };
    }

    if (webhookPaymentDedup.hasDb(prisma, pidStr)) {
        webhookPaymentDedup.recordDbDedup();
        webhookPaymentDedup.markProcessed(pidStr);
        await webhookPaymentDedup.markRedis(pidStr);
        logger.warn(`webhook_dedup_db_hit payment_id=${pidStr}`);
        return { skipped: true, reason: 'db_dedup' };
    }

    const claimed = await webhookPaymentDedup.tryClaimRedis(pidStr);
    if (!claimed) {
        webhookPaymentDedup.recordRedisDedup();
        webhookPaymentDedup.markProcessed(pidStr);
        logger.warn(`webhook_dedup_redis_race payment_id=${pidStr}`);
        return { skipped: true, reason: 'redis_race' };
    }

    let result;
    try {
        result = await SafeWebhookHandler.processPayment(pidStr, payment, bot);
    } catch (e) {
        await webhookPaymentDedup.releaseRedisClaim(pidStr);
        logger.error(`[WEBHOOK] processPayment falhou payment_id=${pidStr}: ${e.message}`);
        throw e;
    }

    if (result.processed || TERMINAL_REASONS.has(result.reason)) {
        webhookPaymentDedup.markProcessed(pidStr);
        webhookPaymentDedup.markDb(prisma, pidStr, result.orderId ?? null);
    } else {
        await webhookPaymentDedup.releaseRedisClaim(pidStr);
    }

    if (result.processed) {
        logger.info(
            `[WEBHOOK] Order ${result.orderId} processed safely via SafeWebhookHandler (tx: ${result.txId})`
        );
    } else {
        logger.warn(`[WEBHOOK] Payment ${pidStr} skipped: ${result.reason}`);
    }

    return { result };
}

/**
 * Express handler — valida antes do 200; receipt durável; sync ou background.
 */
async function handleMpWebhook(req, res, deps) {
    const { logger, deferBackground } = deps;
    const check = validateMpWebhookRequest(req);
    if (!check.ok) {
        logger.webhookRejected(
            check.reason === 'ip' ? 'IP não autorizado' : 'Assinatura HMAC inválida',
            check.ip,
            req.headers['x-signature']
        );
        return res.sendStatus(check.status);
    }

    const { type, data } = req.body || {};
    if (type !== 'payment' || !data?.id) {
        return res.sendStatus(200);
    }

    const pidStr = String(data.id);
    persistReceipt(pidStr, req.body);

    const run = async () => {
        try {
            await processMpPaymentWebhook(deps, pidStr);
            clearReceipt(pidStr);
        } catch (e) {
            logger.error(`[WEBHOOK] processamento falhou payment_id=${pidStr}: ${e.message}`);
            throw e;
        }
    };

    if (isSyncAckEnabled()) {
        try {
            await run();
            return res.sendStatus(200);
        } catch {
            return res.sendStatus(500);
        }
    }

    res.sendStatus(200);
    deferBackground('mp-webhook', () => run().catch((e) => {
        logger.error('Webhook error:', e.message || String(e));
    }));
}

/**
 * Replay receipts pendentes após crash pós-ack (boot recovery).
 */
async function recoverPendingMpWebhooks(deps) {
    if (!isDurableAckEnabled()) return 0;
    const rows = listPendingReceipts();
    if (!rows.length) return 0;

    let replayed = 0;
    for (const row of rows) {
        const pid = String(row.key).slice(RECEIPT_PREFIX.length);
        if (!pid) continue;
        try {
            await processMpPaymentWebhook(deps, pid);
            clearReceipt(pid);
            replayed++;
        } catch (e) {
            deps.logger?.warn?.(`[WEBHOOK] replay pending ${pid}: ${e.message}`);
        }
    }
    if (replayed > 0) {
        deps.logger?.info?.(`[WEBHOOK] replay ${replayed} receipt(s) pendentes pós-crash`);
    }
    return replayed;
}

module.exports = {
    handleMpWebhook,
    validateMpWebhookRequest,
    processMpPaymentWebhook,
    recoverPendingMpWebhooks,
    persistReceipt,
    clearReceipt,
    listPendingReceipts,
    isDurableAckEnabled,
    isSyncAckEnabled,
    RECEIPT_PREFIX,
    TERMINAL_REASONS,
};
