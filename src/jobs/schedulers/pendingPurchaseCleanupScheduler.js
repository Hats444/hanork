'use strict';

const { logSchedulerOn } = require('./cronBootLog');

/** Intervalo padrão: 15 min (legado em bot.js) */
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
/** Janela passada a deleteExpired — legado ignorava o valor (usa cleanupOld(7) no SQLite) */
const DEFAULT_EXPIRE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Limpa registros antigos em pending_purchases (não-PENDING > 7 dias via cleanupOld).
 * @param {number} [nowMs] — para testes
 * @returns {Promise<number>} linhas afetadas
 */
async function runPendingPurchaseCleanup(prisma, _log, nowMs = Date.now()) {
    const limit = nowMs - DEFAULT_EXPIRE_WINDOW_MS;
    return prisma.pendingPurchase.deleteExpired(limit);
}

function startPendingPurchaseCleanupScheduler(prisma, log, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

    logSchedulerOn(log, '[CRON] Pending purchase cleanup scheduler ON', {
        intervalMs,
        expireWindowMs: DEFAULT_EXPIRE_WINDOW_MS,
    });

    return setInterval(async () => {
        try {
            await runPendingPurchaseCleanup(prisma, log);
        } catch (e) {
            log.error('Erro ao limpar compras pendentes expiradas:', e.message);
        }
    }, intervalMs);
}

module.exports = {
    runPendingPurchaseCleanup,
    startPendingPurchaseCleanupScheduler,
    DEFAULT_INTERVAL_MS,
    DEFAULT_EXPIRE_WINDOW_MS,
};
