'use strict';

const { logSchedulerOn } = require('./cronBootLog');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TRACKED_EXPIRED = 200;

/** IDs já notificados aos admins (evita spam) */
const _lastExpiredSales = new Set();

async function runFlashSaleExpiryCycle(deps) {
    const { bot, prisma, config, log } = deps;
    if (!bot?.botInfo) return { notified: 0, skipped: 'bot_not_ready' };

    const before = (prisma.flashSale.findAllActive?.() || []).map((s) => s.id);
    prisma.flashSale.expire();
    const after = new Set((prisma.flashSale.findAllActive?.() || []).map((s) => s.id));

    let notified = 0;
    for (const id of before) {
        if (after.has(id) || _lastExpiredSales.has(id)) continue;
        _lastExpiredSales.add(id);
        for (const aid of config.ID_DONO || []) {
            try {
                await bot.telegram.sendMessage(
                    aid,
                    `⏰ <b>Flash Sale expirada!</b>\n\nA oferta relâmpago #${id} foi encerrada automaticamente.\n\nUse /flashsales para ver as ativas.`,
                    { parse_mode: 'HTML' }
                );
                notified++;
            } catch {
                /* ignore */
            }
        }
    }

    if (_lastExpiredSales.size > MAX_TRACKED_EXPIRED) _lastExpiredSales.clear();
    if (notified > 0) log.debug('[FLASH] Admin notificados de expiração', { sales: before.length - after.size });
    return { notified };
}

function startFlashSaleExpiryScheduler(deps, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    logSchedulerOn(deps.log, '[CRON] Flash sale expiry ON', { intervalMs });

    return setInterval(async () => {
        try {
            await runFlashSaleExpiryCycle(deps);
        } catch (e) {
            deps.log.error('[FLASH] Erro ao expirar ofertas:', e.message);
        }
    }, intervalMs);
}

module.exports = {
    runFlashSaleExpiryCycle,
    startFlashSaleExpiryScheduler,
    DEFAULT_INTERVAL_MS,
    _lastExpiredSales,
};
