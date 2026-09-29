'use strict';

const { logSchedulerOn } = require('./cronBootLog');

const DEFAULT_INTERVAL_MS = Math.max(
    60000,
    parseInt(process.env.PIX_PENDING_REMINDER_INTERVAL_MS || String(10 * 60 * 1000), 10)
);

function reminderAfterMinutes() {
    return Math.max(10, parseInt(process.env.PIX_PENDING_REMINDER_AFTER_MIN || '15', 10));
}

function reminderWindowMinutes() {
    return Math.max(5, parseInt(process.env.PIX_PENDING_REMINDER_WINDOW_MIN || '13', 10));
}

/**
 * Lembrete amigável: PIX gerado há ~15 min ainda pendente (antes do aviso de expiração ~30 min).
 * @param {{ prisma, bot, Markup, log }} deps
 */
async function runPixPendingReminderCycle(deps) {
    const { prisma, bot, Markup, log } = deps;
    const after = reminderAfterMinutes();
    const window = reminderWindowMinutes();
    const pending = prisma.pendingPurchase.getPendingPixForReminder(after, window);

    for (const compra of pending) {
        const alreadyNotified = await prisma.notification.wasSent(
            compra.user_id,
            'pix_pending_reminder',
            compra.order_id
        );
        if (alreadyNotified) continue;

        try {
            await bot.telegram.sendMessage(
                compra.telegram_id,
                `💳 <b>Seu PIX ainda está aguardando pagamento</b>\n\n` +
                    `🔑 Pedido #${String(compra.order_id).slice(-8)}\n` +
                    `💰 R$ ${Number(compra.total).toFixed(2)}\n\n` +
                    `Se já pagou, aguarde a confirmação automática.\n` +
                    `Caso contrário, use o botão abaixo para ver o QR ou gerar um novo PIX.`,
                {
                    parse_mode: 'HTML',
                    reply_markup: Markup.inlineKeyboard([
                        [{ text: '📋 Ver PIX', callback_data: `pp_${compra.order_id}` }],
                        [{ text: '🔄 Gerar novo PIX', callback_data: `payment_methods_${compra.order_id}` }],
                        [{ text: '🏠 Menu', callback_data: 'menu:home' }],
                    ]).reply_markup,
                }
            );

            await prisma.notification.markSent(
                compra.user_id,
                compra.telegram_id,
                'pix_pending_reminder',
                compra.order_id
            );
            log.info(`[PIX] Lembrete pendente enviado: ${compra.telegram_id} - ${compra.order_id}`);
        } catch {
            /* bloqueio / erro Telegram */
        }
    }
}

function startPixPendingReminderScheduler(deps, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    logSchedulerOn(deps.log, '[CRON] PIX pending reminder scheduler ON', {
        intervalMs,
        afterMin: reminderAfterMinutes(),
        windowMin: reminderWindowMinutes(),
    });

    return setInterval(async () => {
        try {
            await runPixPendingReminderCycle(deps);
        } catch (e) {
            deps.log.error('Erro no lembrete PIX pendente:', e.message);
        }
    }, intervalMs);
}

module.exports = {
    runPixPendingReminderCycle,
    startPixPendingReminderScheduler,
    DEFAULT_INTERVAL_MS,
    reminderAfterMinutes,
    reminderWindowMinutes,
};
