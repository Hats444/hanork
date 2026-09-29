'use strict';

const { logSchedulerOn } = require('./cronBootLog');
const { runWebhookDedupCleanup, RETENTION_MS } = require('../../modules/payment/webhookPaymentDedup');

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

function startWebhookDedupCleanupScheduler(log, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    logSchedulerOn(log, '[CRON] Webhook payment dedup cleanup ON', { intervalMs, retentionMs: RETENTION_MS });

    return setInterval(() => {
        try {
            runWebhookDedupCleanup(log);
        } catch (e) {
            log.error('Erro na limpeza dedup webhook:', e.message);
        }
    }, intervalMs);
}

module.exports = {
    startWebhookDedupCleanupScheduler,
    DEFAULT_INTERVAL_MS,
    runWebhookDedupCleanup,
};
