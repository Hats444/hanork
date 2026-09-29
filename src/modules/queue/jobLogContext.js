'use strict';

/**
 * Metadados padronizados para logs de jobs Bull (observabilidade).
 */
function jobLogFields(job, extra = {}) {
    const data = job?.data && typeof job.data === 'object' ? job.data : {};
    const queueName =
        job?.queue?.name ||
        (typeof job?.queue?.key === 'string' ? job.queue.key : null) ||
        extra.queueName ||
        null;

    return {
        jobId: job?.id != null ? String(job.id) : null,
        queue: queueName,
        orderId: data.orderId != null ? String(data.orderId) : null,
        userId: data.userId != null ? data.userId : null,
        telegramId: data.telegramId != null ? String(data.telegramId) : null,
        ...extra,
    };
}

module.exports = { jobLogFields };
