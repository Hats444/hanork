'use strict';

const { logSchedulerOn } = require('./cronBootLog');

/** Intervalo padrão: 30 min (igual ao legado em bot.js) */
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_OLDER_THAN_MINUTES = 30;

/**
 * Remove carrinhos inativos do SQLite (active_carts).
 * @returns {Promise<{ deleted: number }>}
 */
async function runCartCleanup(prisma, log, olderThanMinutes = DEFAULT_OLDER_THAN_MINUTES) {
    const result = await prisma.cart.cleanupOld(olderThanMinutes);
    if (result.deleted > 0) {
        log.info(`[CRON] Carrinhos expirados removidos: ${result.deleted}`);
    }
    return result;
}

/**
 * Agenda limpeza periódica. Retorna handle do setInterval (para testes/shutdown futuro).
 */
function startCartCleanupScheduler(prisma, log, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    const olderThanMinutes = options.olderThanMinutes ?? DEFAULT_OLDER_THAN_MINUTES;

    logSchedulerOn(log, '[CRON] Cart cleanup scheduler ON', { intervalMs, olderThanMinutes });

    return setInterval(async () => {
        try {
            await runCartCleanup(prisma, log, olderThanMinutes);
        } catch (e) {
            log.error('Erro ao limpar carrinhos antigos:', e.message);
        }
    }, intervalMs);
}

module.exports = {
    runCartCleanup,
    startCartCleanupScheduler,
    DEFAULT_INTERVAL_MS,
    DEFAULT_OLDER_THAN_MINUTES,
};
