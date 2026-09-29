'use strict';

const logger = require('../../../config/logger');
const { isSmmEnabled } = require('../smmEnabled');
const { CB, PATTERNS } = require('../utils/smmCallbackData');
const {
    sendPlatforms,
    sendSubcategories,
    sendServiceList,
    sendServiceDetail,
    sendSearchResults,
    platformFromSlug,
    subFromSlug,
} = require('../handlers/smmUiHandlers');
const {
    startBuyWizard,
    handleWizardText,
    clearWizard,
    readConfirmWizard,
} = require('../handlers/smmWizardHandler');
const SmmCheckoutService = require('../services/checkoutService');
const { registerSmmAdminCommands } = require('./smmAdminCommands');
const { safeAnswerCbQuery } = require('../../../utils/safeTelegram');
const { checkSmmRate } = require('../middlewares/smmRateLimiter');
const SmmOrderService = require('../services/orderService');
const { sendUserOrders, sendOrderDetail } = require('../handlers/smmOrderActionsHandler');
const { actionErrorMessage, checkoutErrorMessage } = require('../validators/smmActionValidator');

function registerSmmCommands(bot, deps) {
    if (!isSmmEnabled()) return;

    const {
        Msg,
        Markup,
        isAdmin,
        stateManager,
        requirePrivate,
        cartKey,
        comprasPendentes,
        Menu,
        getAffSaldo,
        checkCheckoutCooldown,
    } = deps;

    logger.info('[SMM] Registrando comandos e callbacks Telegram');

    registerSmmAdminCommands(bot, { isAdmin, Msg });

    async function guardPrivate(ctx) {
        if (requirePrivate && !(await requirePrivate(ctx))) return false;
        return true;
    }

    async function guardRate(ctx, action, options) {
        const rl = await checkSmmRate(stateManager, ctx.from?.id, action, options);
        if (!rl.allowed) {
            await Msg.reply(ctx, checkoutErrorMessage('rate_limited'));
            return false;
        }
        return true;
    }

    bot.command(['smm', 'servicos'], async (ctx) => {
        if (!(await guardPrivate(ctx))) return;
        if (!(await guardRate(ctx, 'catalog'))) return;
        await sendPlatforms(ctx, Msg);
    });

    bot.command('smm_pedidos', async (ctx) => {
        if (!(await guardPrivate(ctx))) return;
        if (!(await guardRate(ctx, 'orders'))) return;
        await sendUserOrders(ctx, Msg, ctx.from?.id);
    });

    async function handleSmmSearch(ctx) {
        if (!(await guardPrivate(ctx))) return;
        if (!(await guardRate(ctx, 'search'))) return;
        const query = (ctx.message.text || '')
            .replace(/^\/(?:smm_)?buscar(?:@\w+)?\s*/i, '')
            .trim();
        if (!query) {
            return Msg.reply(
                ctx,
                '🔍 <b>Busca SMM</b>\n\n' +
                    'Uso: <code>/buscar seguidores instagram</code>\n' +
                    'Ex: <code>/buscar curtidas tiktok</code>\n\n' +
                    '<i>Alias: /smm_buscar</i>',
                { parse_mode: 'HTML' }
            );
        }
        await sendSearchResults(ctx, Msg, query);
    }

    bot.command(['smm_buscar', 'buscar'], handleSmmSearch);

    bot.action(CB.HOME, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardPrivate(ctx))) return;
        await sendPlatforms(ctx, Msg);
    });

    bot.action(PATTERNS.platform, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardPrivate(ctx))) return;
        const platform = platformFromSlug(ctx.match[1]);
        await sendSubcategories(ctx, Msg, platform);
    });

    bot.action(PATTERNS.sub, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardPrivate(ctx))) return;
        const platform = platformFromSlug(ctx.match[1]);
        const sub = subFromSlug(ctx.match[2]);
        await sendServiceList(ctx, Msg, platform, sub, 0);
    });

    bot.action(PATTERNS.list, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardPrivate(ctx))) return;
        const platform = platformFromSlug(ctx.match[1]);
        const sub = subFromSlug(ctx.match[2]);
        const page = parseInt(ctx.match[3], 10) || 0;
        await sendServiceList(ctx, Msg, platform, sub, page);
    });

    bot.action(PATTERNS.view, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardPrivate(ctx))) return;
        const id = parseInt(ctx.match[1], 10);
        await sendServiceDetail(ctx, Msg, id);
    });

    bot.action(PATTERNS.buy, async (ctx) => {
        await safeAnswerCbQuery(ctx, '🛒 Abrindo pedido…');
        if (!(await guardPrivate(ctx))) return;
        const id = parseInt(ctx.match[1], 10);
        await startBuyWizard(ctx, Msg, stateManager, id);
    });

    bot.action(CB.cancelWizard, async (ctx) => {
        await safeAnswerCbQuery(ctx, 'Cancelado');
        await clearWizard(stateManager, ctx.from?.id);
        await sendPlatforms(ctx, Msg);
    });

    bot.action(CB.orders, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardPrivate(ctx))) return;
        await sendUserOrders(ctx, Msg, ctx.from?.id);
    });

    bot.action(PATTERNS.orderView, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardPrivate(ctx))) return;
        const id = parseInt(ctx.match[1], 10);
        await sendOrderDetail(ctx, Msg, id, ctx.from?.id);
    });

    bot.action(PATTERNS.refill, async (ctx) => {
        await safeAnswerCbQuery(ctx, '♻️ Solicitando…');
        if (!(await guardPrivate(ctx))) return;
        if (!(await guardRate(ctx, 'refill', { max: 5, windowSec: 3600 }))) return;
        const id = parseInt(ctx.match[1], 10);
        const result = await SmmOrderService.requestRefill(id, ctx.from?.id);
        if (!result.ok) {
            return Msg.reply(ctx, actionErrorMessage(result.error));
        }
        return Msg.reply(ctx, `♻️ <b>Reposição solicitada!</b>\n\nRefill: <code>${result.refillId}</code>`, {
            parse_mode: 'HTML',
        });
    });

    bot.action(PATTERNS.cancelAsk, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardPrivate(ctx))) return;
        const id = parseInt(ctx.match[1], 10);
        return Msg.reply(
            ctx,
            '❓ <b>Confirmar cancelamento?</b>\n\nEsta ação não pode ser desfeita.',
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [{ text: '✅ Sim, cancelar', callback_data: CB.cancelConfirm(id) }],
                    [{ text: '↩️ Voltar', callback_data: CB.orderView(id) }],
                ]),
            }
        );
    });

    bot.action(PATTERNS.cancelConfirm, async (ctx) => {
        await safeAnswerCbQuery(ctx, 'Cancelando…');
        if (!(await guardPrivate(ctx))) return;
        if (!(await guardRate(ctx, 'cancel', { max: 5, windowSec: 3600 }))) return;
        const id = parseInt(ctx.match[1], 10);
        const result = await SmmOrderService.requestCancel(id, ctx.from?.id);
        if (!result.ok) {
            return Msg.reply(ctx, actionErrorMessage(result.error));
        }
        return Msg.reply(ctx, '✅ <b>Pedido cancelado</b> com sucesso.', { parse_mode: 'HTML' });
    });

    bot.action(CB.confirmPay, async (ctx) => {
        await safeAnswerCbQuery(ctx, '💳 Abrindo pagamento…');
        if (!(await guardPrivate(ctx))) return;
        if (!(await guardRate(ctx, 'checkout', { max: 8, windowSec: 300 }))) return;

        const w = await readConfirmWizard(stateManager, ctx.from?.id);
        if (!w) {
            return Msg.reply(ctx, '⚠️ Sessão expirada. Escolha o serviço novamente.', {
                ...Markup.inlineKeyboard([[{ text: '📱 Serviços SMM', callback_data: CB.HOME }]]),
            });
        }

        const checkoutDeps = {
            cartKey,
            comprasPendentes,
            Menu,
            getAffSaldo,
            checkCheckoutCooldown,
        };
        const result = await SmmCheckoutService.createPaymentSession(ctx, checkoutDeps, {
            serviceId: w.serviceId,
            link: w.link,
            quantity: w.quantity,
        });

        if (!result.ok) {
            if (result.error === 'cooldown') {
                return Msg.reply(
                    ctx,
                    `⏳ Aguarde <b>${result.remaining || 30}s</b> antes de outro checkout.`,
                    { parse_mode: 'HTML' }
                );
            }
            return Msg.reply(ctx, result.message || checkoutErrorMessage(result.error) || '❌ Não foi possível criar o pedido.');
        }

        await clearWizard(stateManager, ctx.from.id);

        const svc = result.service;
        const total = result.total;
        const affSaldo = getAffSaldo ? await getAffSaldo(ctx) : 0;
        const text = SmmCheckoutService.buildPaymentMessage(
            result.orderId,
            svc,
            w.quantity,
            total
        );
        const kb = SmmCheckoutService.paymentKeyboard(result.orderId, affSaldo, total, Menu);

        return Msg.reply(ctx, text, { parse_mode: 'HTML', ...kb });
    });

    bot.on('text', async (ctx, next) => {
        if (!isSmmEnabled() || ctx.chat?.type !== 'private') return next();
        const handled = await handleWizardText(ctx, Msg, stateManager, ctx.message?.text);
        if (handled) return;
        return next();
    });
}

module.exports = { registerSmmCommands };
