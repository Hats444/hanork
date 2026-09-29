'use strict';

const { Markup } = require('telegraf');
const { escapeTelegramHtml } = require('../../htmlEscape');

const TOUR_KV_PREFIX = 'user_welcome_tour_done:';
const TOTAL_STEPS = 2;

function tourKvKey(telegramId) {
    return `${TOUR_KV_PREFIX}${String(telegramId)}`;
}

function isWelcomeTourAutoEnabled() {
    const v = String(process.env.WELCOME_TOUR_AUTO ?? '0').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function hasCompletedWelcomeTour(dbRaw, telegramId) {
    if (!telegramId) return true;
    try {
        const row = dbRaw().prepare('SELECT 1 FROM kv_store WHERE key=?').get(tourKvKey(telegramId));
        return !!row;
    } catch {
        return false;
    }
}

function markWelcomeTourCompleted(dbRaw, telegramId) {
    if (!telegramId) return;
    try {
        dbRaw().prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, '1', datetime('now'))`
        ).run(tourKvKey(telegramId));
    } catch {
        /* ignore */
    }
}

function progressDots(step) {
    const filled = '●';
    const empty = '○';
    return Array.from({ length: TOTAL_STEPS }, (_, i) => (i < step ? filled : empty)).join(' ');
}

function shouldAutoStartWelcomeTour(ctx, { isNew, payload, isAdmin, isGroupChat }) {
    if (!isWelcomeTourAutoEnabled()) return false;
    if (isGroupChat || isAdmin) return false;
    if (!isNew) return false;
    if (payload && String(payload).trim()) return false;
    return true;
}

function buildStepText(step, nome) {
    const head = `<i>${progressDots(step)} · passo ${step} de ${TOTAL_STEPS}</i>\n\n`;

    switch (step) {
        case 1:
            return (
                head +
                `<b>Olá, ${nome}!</b>\n\n` +
                `Bem-vindo à <b>Hanork</b> — produtos digitais com entrega automática.\n\n` +
                `Como funciona:\n` +
                `1. Toque em <b>Catálogo</b> ou <b>Começar agora</b>\n` +
                `2. <b>Números SMS</b> — <code>/numeros</code> + app e país (ex.: whatsapp brasil)\n` +
                `3. Escolha o produto e pague com <b>PIX</b> ou <b>cartão</b>\n` +
                `4. Receba tudo neste chat em segundos\n\n` +
                `<i>Toque em <b>Próximo</b> para ver seu cupom de boas-vindas.</i>`
            );
        case 2:
        default:
            return (
                head +
                `<b>Presente de boas-vindas</b>\n\n` +
                `Cupom na <b>primeira compra</b>:\n\n` +
                `Código: <code>BEM10</code>\n` +
                `<b>10% de desconto</b> — use <code>/cupom BEM10</code> antes do checkout\n\n` +
                `Precisa de ajuda? <b>Suporte</b> no menu ou <code>/suporte</code>.\n\n` +
                `<i>Pronto — escolha uma opção abaixo.</i>`
            );
    }
}

function buildStepKeyboard(step) {
    switch (step) {
        case 1:
            return Markup.inlineKeyboard([
                [{ text: '➡️ Próximo — cupom BEM10', callback_data: 'ob_2' }],
                [{ text: '🛍️ Ver catálogo', callback_data: 'cat' }],
                [{ text: '⏭️ Ir ao menu', callback_data: 'ob_skip' }],
            ]);
        case 2:
        default:
            return Markup.inlineKeyboard([
                [{ text: '🛍️ Ver catálogo', callback_data: 'cat' }],
                [{ text: '🏷️ Salvar cupom BEM10', callback_data: 'cupom_boas_vindas' }],
                [{ text: '🏠 Menu', callback_data: 'ob_finish' }],
                [{ text: '⬅️ Voltar', callback_data: 'ob_1' }],
            ]);
    }
}

function ensureWelcomeCoupon(dbRaw) {
    try {
        const db = dbRaw();
        const existing = db.prepare('SELECT id FROM coupons WHERE code=?').get('BEM10');
        if (!existing) {
            db.prepare(
                `INSERT OR IGNORE INTO coupons (code,type,value,max_uses,used,min_total,active) VALUES ('BEM10','percent',10,1,0,0,1)`
            ).run();
        }
    } catch {
        /* ignore */
    }
}

function registerWelcomeTourHandlers(bot, deps) {
    const {
        Msg,
        dbRaw,
        Cart,
        cartKey,
        cuponsAplicados,
        onboardingStep,
        isGroupChat,
        groupGuard,
        sendMainMenu,
    } = deps;

    async function showStep(ctx, step) {
        onboardingStep.set(ctx.chat.id, step);
        const nome = escapeTelegramHtml(ctx.from?.first_name || 'amigo(a)');
        const text = buildStepText(step, nome);
        const kb = buildStepKeyboard(step);

        if (ctx.callbackQuery?.message) {
            await Msg.editCallbackPanel(ctx, text, kb, { useMenuPhoto: true });
        } else {
            await Msg.replaceMenu(ctx, text, kb, { useMenuPhoto: true });
        }
    }

    async function finishTour(ctx, { openMenu = true } = {}) {
        onboardingStep.delete(ctx.chat.id);
        markWelcomeTourCompleted(dbRaw, ctx.from?.id);
        if (openMenu) {
            if (ctx.callbackQuery?.message) {
                await ctx.answerCbQuery('✅ Tour concluído').catch(() => {});
            }
            await sendMainMenu(ctx);
        }
    }

    async function startWelcomeTour(ctx) {
        ensureWelcomeCoupon(dbRaw);
        await showStep(ctx, 1);
    }

    bot.action(/^ob_([1-2])$/, async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        const step = parseInt(ctx.match[1], 10);
        if (step === 2) ensureWelcomeCoupon(dbRaw);
        await showStep(ctx, step);
    });

    bot.action('ob_skip', async (ctx) => {
        await ctx.answerCbQuery('Indo ao menu…').catch(() => {});
        onboardingStep.delete(ctx.chat.id);
        markWelcomeTourCompleted(dbRaw, ctx.from?.id);
        await sendMainMenu(ctx);
    });

    bot.action('ob_finish', async (ctx) => {
        await finishTour(ctx, { openMenu: true });
    });

    bot.action('cupom_boas_vindas', async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        ensureWelcomeCoupon(dbRaw);
        markWelcomeTourCompleted(dbRaw, ctx.from?.id);
        onboardingStep.delete(ctx.chat.id);

        const db = dbRaw();
        const cupom = db.prepare('SELECT * FROM coupons WHERE code=?').get('BEM10');
        if (!cupom || !cupom.active) {
            return Msg.reply(ctx, '❌ Cupom BEM10 indisponível no momento. Use o menu para ver o catálogo.');
        }
        const total = await Cart.total(cartKey(ctx));
        if (total <= 0) {
            return Msg.editCallbackPanel(
                ctx,
                `🏷️ <b>Cupom BEM10 reservado!</b>\n\n` +
                    `Adicione produtos ao carrinho e use <code>/cupom BEM10</code> antes de finalizar.\n\n` +
                    `<i>O desconto de 10% será aplicado no checkout.</i>`,
                Markup.inlineKeyboard([
                    [{ text: '🛍️ Ver catálogo', callback_data: 'cat' }],
                    [{ text: '🏠 Menu', callback_data: 'menu:home' }],
                ])
            );
        }
        const desc = total * 0.10;
        const finalTotal = total - desc;
        await cuponsAplicados.set(cartKey(ctx), { code: 'BEM10', discount: desc, finalTotal, coupon: cupom });
        await Msg.editCallbackPanel(
            ctx,
            `✅ <b>Cupom BEM10 aplicado!</b>\n\n` +
                `💰 Subtotal: R$ ${total.toFixed(2)}\n` +
                `➖ Desconto (10%): −R$ ${desc.toFixed(2)}\n\n` +
                `<b>Total: R$ ${finalTotal.toFixed(2)}</b>`,
            Markup.inlineKeyboard([
                [{ text: '💳 Finalizar compra', callback_data: 'checkout' }],
                [{ text: '🛒 Ver carrinho', callback_data: 'cart' }],
                [{ text: '🏠 Menu', callback_data: 'menu:home' }],
            ])
        );
    });

    bot.command('tour', async (ctx) => {
        if (isGroupChat(ctx)) {
            return groupGuard.replyGroupRedirect(ctx, bot, {
                body: 'O tour guiado funciona apenas em conversa privada com o bot.',
            });
        }
        return startWelcomeTour(ctx);
    });

    return { startWelcomeTour, finishTour, hasCompletedWelcomeTour: (tid) => hasCompletedWelcomeTour(dbRaw, tid) };
}

module.exports = {
    registerWelcomeTourHandlers,
    shouldAutoStartWelcomeTour,
    isWelcomeTourAutoEnabled,
    hasCompletedWelcomeTour,
    markWelcomeTourCompleted,
    TOTAL_STEPS,
};
