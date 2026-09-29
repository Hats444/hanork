'use strict';

/**
 * B3 — restock, avaliação e reenvio (callbacks de pós-compra).
 */
function registerOrderFeedbackHandlers(bot, deps) {
    const {
        prisma,
        Markup,
        logger,
        getProductById,
        sendProductWithPhoto,
        deliverProducts,
    } = deps;

    bot.action(/^notify_restock_(\d+)$/, async (ctx) => {
        const pid = parseInt(ctx.match[1], 10);
        const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        if (!user) return ctx.answerCbQuery('Faça /start primeiro.');
        const already = await prisma.restockNotify.isRegistered(user.id, pid);
        if (already) {
            await prisma.restockNotify.remove(user.id, pid);
            await ctx.answerCbQuery('🔔 Notificação cancelada.');
        } else {
            await prisma.restockNotify.add(user.id, pid, ctx.from.id);
            await ctx.answerCbQuery('🔔 Você será avisado quando chegar!');
        }
        const p = await getProductById(pid);
        if (p) await sendProductWithPhoto(ctx, p);
    });

    bot.action(/^rate_(.+)_(\d)$/, async (ctx) => {
        const oid = ctx.match[1];
        const stars = parseInt(ctx.match[2], 10);
        try {
            const ReviewService = require('../../../services/ReviewService');
            await ReviewService.submitFromCallback(ctx, oid, stars);
        } catch (e) {
            logger.warn('[REVIEW] rate callback', { oid, message: e?.message });
            try {
                await ctx.answerCbQuery('❌ Erro ao registrar avaliação', { show_alert: true });
            } catch {
                /* ignore */
            }
        }
    });

    bot.action(/^resend_cd_(.+)$/, async (ctx) => {
        const ResendService = require('../../../services/ResendService');
        await ResendService.handleCooldownTap(ctx, ctx.match[1]);
    });

    bot.action(/^resend_(.+)$/, async (ctx) => {
        const oid = ctx.match[1];
        try {
            const ResendService = require('../../../services/ResendService');
            await ResendService.submitFromCallback(ctx, oid, (c, chatId, items) =>
                deliverProducts(c, chatId, items)
            );
        } catch (e) {
            logger.warn('[Resend] callback', { oid, message: e?.message });
            try {
                await ctx.answerCbQuery('❌ Erro no reenvio', { show_alert: true });
            } catch {
                /* ignore */
            }
        }
    });
}

async function notifyRestock(deps, productId, productName) {
    const { bot, prisma, Markup } = deps;
    if (!bot.botInfo) return;
    const pending = await prisma.restockNotify.findPending(productId);
    if (!pending.length) return;
    for (const n of pending) {
        try {
            await bot.telegram.sendMessage(
                parseInt(n.telegram_id, 10),
                `🔔 <b>Produto disponível!</b>\n\n📦 <b>${productName}</b> está de volta ao estoque!\n\nCorra antes que acabe:`,
                {
                    parse_mode: 'HTML',
                    reply_markup: Markup.inlineKeyboard([
                        [{ text: '⚡ Comprar Agora', callback_data: `p_${productId}` }],
                        [{ text: '🛍️ Ver Catálogo', callback_data: 'cat' }],
                    ]).reply_markup,
                }
            );
        } catch {
            /* ignore */
        }
    }
    await prisma.restockNotify.markNotified(productId);
}

module.exports = { registerOrderFeedbackHandlers, notifyRestock };
