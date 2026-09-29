'use strict';

const { logSchedulerOn } = require('./cronBootLog');

const DEFAULT_INTERVAL_MS = Math.max(
    60000,
    parseInt(process.env.ABANDONED_CART_INTERVAL_MS || String(30 * 60 * 1000), 10)
);

function abandonedCartMinutes() {
    return Math.max(5, parseInt(process.env.ABANDONED_CART_MINUTES || '60', 10));
}

function buildOldCartsSql() {
    const minutes = abandonedCartMinutes();
    return `
    SELECT DISTINCT user_id, telegram_id
    FROM active_carts
    WHERE updated_at < datetime('now', '-${minutes} minutes')
    GROUP BY user_id
`;
}

/**
 * Um ciclo: notifica usuários com carrinho abandonado (padrão: >60min sem atualizar).
 * @param {{ prisma, dbRaw: Function, bot, Markup, log }} deps
 */
async function runAbandonedCartCycle(deps) {
    const { prisma, dbRaw, bot, Markup, log } = deps;
    const oldCarts = dbRaw().prepare(buildOldCartsSql()).all();

    for (const cart of oldCarts) {
        const telegram_id = cart.telegram_id;

        const alreadyNotified = await prisma.notification.wasSent(
            cart.user_id,
            'cart_abandoned',
            telegram_id
        );
        if (alreadyNotified) continue;

        const items = await prisma.cart.getByTelegram(telegram_id);
        if (!items || items.length === 0) continue;

        const total = items.reduce((s, item) => s + (item.product_price * item.quantity), 0);

        const ctaVariant = Number(telegram_id) % 2 === 0 ? 'A' : 'B';
        const ctaLabel =
            ctaVariant === 'A' ? '🛒 Finalizar Compra' : '✅ Concluir Pedido Agora';
        const ctaBody =
            ctaVariant === 'A'
                ? `Complete sua compra antes que os produtos acabem! 👇`
                : `Seus itens ainda estão reservados — finalize em 1 clique 👇`;

        try {
            await bot.telegram.sendMessage(
                telegram_id,
                `🛒 <b>Seu carrinho está esperando!</b>\n\n` +
                    items.map((i) => `• ${i.product_name} x${i.quantity}`).join('\n') +
                    `\n\n💰 Total: <b>R$ ${total.toFixed(2)}</b>\n\n` +
                    ctaBody,
                {
                    parse_mode: 'HTML',
                    reply_markup: Markup.inlineKeyboard([
                        [{ text: ctaLabel, callback_data: 'cart' }],
                        [{ text: '🏠 Menu', callback_data: 'home' }],
                    ]).reply_markup,
                }
            );

            await prisma.notification.markSent(cart.user_id, telegram_id, 'cart_abandoned', telegram_id);
            log.info(`[CART] Notificação de abandono enviada: ${telegram_id}`);
        } catch {
            // Usuário pode ter bloqueado o bot
        }
    }
}

function startAbandonedCartScheduler(deps, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    logSchedulerOn(deps.log, '[CRON] Abandoned cart scheduler ON', {
        intervalMs,
        abandonMinutes: abandonedCartMinutes(),
    });

    return setInterval(async () => {
        try {
            await runAbandonedCartCycle(deps);
        } catch (e) {
            deps.log.error('Erro no sistema de carrinho abandonado:', e.message);
        }
    }, intervalMs);
}

module.exports = {
    runAbandonedCartCycle,
    startAbandonedCartScheduler,
    DEFAULT_INTERVAL_MS,
    abandonedCartMinutes,
    buildOldCartsSql,
};
