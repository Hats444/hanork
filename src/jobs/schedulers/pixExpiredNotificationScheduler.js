'use strict';

const { logSchedulerOn } = require('./cronBootLog');

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Notifica usuários com PIX pendente expirado (>30 min no banco).
 * @param {{ prisma, bot, Markup, log }} deps
 */
async function runPixExpiredNotificationCycle(deps) {
    const { prisma, bot, Markup, log } = deps;
    const expiredPix = await prisma.pendingPurchase.getExpiredPix();

    for (const compra of expiredPix) {
        const alreadyNotified = await prisma.notification.wasSent(
            compra.user_id,
            'pix_expired',
            compra.order_id
        );
        if (alreadyNotified) continue;

        try {
            await bot.telegram.sendMessage(
                compra.telegram_id,
                `⏰ <b>Seu PIX expirou!</b>\n\n` +
                    `🔑 Pedido #${compra.order_id.slice(-8)}\n` +
                    `💰 R$ ${compra.total.toFixed(2)}\n\n` +
                    `Gere um novo PIX para continuar:`,
                {
                    parse_mode: 'HTML',
                    reply_markup: Markup.inlineKeyboard([
                        [{ text: '🔄 Gerar novo PIX', callback_data: `pp_${compra.order_id}` }],
                        [{ text: '💳 Outras formas', callback_data: `payment_methods_${compra.order_id}` }],
                        [{ text: '❌ Cancelar', callback_data: 'home' }],
                    ]).reply_markup,
                }
            );

            await prisma.notification.markSent(
                compra.user_id,
                compra.telegram_id,
                'pix_expired',
                compra.order_id
            );
            log.info(`[PIX] Expiração notificada: ${compra.telegram_id} - ${compra.order_id}`);
        } catch {
            /* bloqueio / erro Telegram */
        }
    }
}

function startPixExpiredNotificationScheduler(deps, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    logSchedulerOn(deps.log, '[CRON] PIX expired notification scheduler ON', { intervalMs });

    return setInterval(async () => {
        try {
            await runPixExpiredNotificationCycle(deps);
        } catch (e) {
            deps.log.error('Erro na notificação de PIX expirado:', e.message);
        }
    }, intervalMs);
}

module.exports = {
    runPixExpiredNotificationCycle,
    startPixExpiredNotificationScheduler,
    DEFAULT_INTERVAL_MS,
};
