'use strict';

const QueueService = require('../modules/queue/QueueService');
const logger = require('../config/logger');
const { isPvBroadcastQueueEnabled, resolvePvMaxJobAgeMs } = require('../config/broadcastConfig');

const QUEUE_NAME = 'broadcast:pv';

/**
 * Remove jobs PV pendentes do Redis no boot (evita reenvio em massa após restart).
 * Espelha resetCatalogAiQueueOnBoot do plugin WA.
 */
async function resetPvBroadcastQueueOnBoot() {
    if (!isPvBroadcastQueueEnabled()) {
        return { skipped: true, reason: 'queue_disabled' };
    }
    const keep = String(process.env.BROADCAST_PV_KEEP_QUEUE_ON_BOOT || '').trim().toLowerCase();
    if (keep === '1' || keep === 'true' || keep === 'yes') {
        return { skipped: true, reason: 'keep_on_boot' };
    }

    try {
        const queue = QueueService.initQueue(QUEUE_NAME);
        let removed = 0;
        for (const state of ['waiting', 'delayed', 'paused']) {
            const jobs = await queue.getJobs([state], 0, 2000);
            for (const job of jobs) {
                try {
                    await job.remove();
                    removed++;
                } catch {
                    /* job já processado ou removido */
                }
            }
        }
        if (removed > 0) {
            logger.info('[BROADCAST] Fila PV limpa no boot', { removed });
        }
        return { ok: true, removed };
    } catch (e) {
        logger.warn('[BROADCAST] reset PV queue on boot:', e.message);
        return { ok: false, error: e.message };
    }
}

function isStalePvBroadcastJob(job) {
    const maxAge = resolvePvMaxJobAgeMs();
    if (!maxAge || maxAge <= 0) return false;
    const enqueuedAt = Number(job?.data?.enqueuedAt || 0);
    if (!enqueuedAt) return false;
    return Date.now() - enqueuedAt > maxAge;
}

module.exports = {
    QUEUE_NAME,
    resetPvBroadcastQueueOnBoot,
    isStalePvBroadcastJob,
};
