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
    resumeWizardLink,
    resumeWizardQuantity,
} = require('../handlers/smmWizardHandler');
const L = require('../utils/smmLabels');
const SmmCheckoutService = require('../services/checkoutService');
const CatalogService = require('../services/catalogService');
const { registerSmmAdminCommands } = require('./smmAdminCommands');
const { safeAnswerCbQuery } = require('../../../utils/safeTelegram');
const { checkSmmRate } = require('../middlewares/smmRateLimiter');
const SmmOrderService = require('../services/orderService');
const { sendUserOrders, sendOrderDetail } = require('../handlers/smmOrderActionsHandler');
const { actionErrorMessage, checkoutErrorMessage } = require('../validators/smmActionValidator');
const { assertSmmCatalogAccess } = require('../smmAccess');
const { smmPanel } = require('../helpers/smmPanelUi');
const {
    checkoutNoticeKeyboard,
    cooldownNoticeKeyboard,
    catalogNoticeKeyboard,
    actionNoticeKeyboard,
} = require('../keyboards/smmNoticeKeyboards');

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
        getWalletSaldo,
        checkCheckoutCooldown,
        cuponsAplicados,
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
            await smmPanel(ctx, Msg, checkoutErrorMessage('rate_limited'), cooldownNoticeKeyboard());
            return false;
        }
        return true;
    }

    async function guardCatalog(ctx) {
        if (!(await guardPrivate(ctx))) return false;
        return assertSmmCatalogAccess(ctx, Msg, isAdmin);
    }

    bot.command(['smm', 'servicos'], async (ctx) => {
        if (!(await guardCatalog(ctx))) return;
        if (!(await guardRate(ctx, 'catalog'))) return;
        await sendPlatforms(ctx, Msg);
    });

    bot.command('smm_pedidos', async (ctx) => {
        if (!(await guardCatalog(ctx))) return;
        if (!(await guardRate(ctx, 'orders'))) return;
        await sendUserOrders(ctx, Msg, ctx.from?.id);
    });

    async function handleSmmSearch(ctx) {
        if (!(await guardCatalog(ctx))) return;
        if (!(await guardRate(ctx, 'search'))) return;
        const query = (ctx.message.text || '')
            .replace(/^\/(?:smm_)?buscar(?:@\w+)?\s*/i, '')
            .trim();
        if (!query) {
            return Msg.reply(
                ctx,
                '🔍 <b>Busca Hanork</b>\n\n' +
                    'Busca em <b>SMM</b> e <b>Números SMS</b>:\n\n' +
                    '<code>/buscar seguidores instagram</code>\n' +
                    '<code>/buscar whatsapp brasil</code>\n' +
                    '<code>/buscar telegram portugal</code>\n\n' +
                    '<i>Alias: /smm_buscar</i>',
                { parse_mode: 'HTML' }
            );
        }
        const UnifiedServiceSearch = require('../../../services/UnifiedServiceSearch');
        await UnifiedServiceSearch.dispatch(ctx, Msg, query, isAdmin);
    }

    bot.command(['smm_buscar', 'buscar'], handleSmmSearch);

    bot.action(CB.HOME, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardCatalog(ctx))) return;
        await sendPlatforms(ctx, Msg);
    });

    bot.action(PATTERNS.platform, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardCatalog(ctx))) return;
        const platform = platformFromSlug(ctx.match[1]);
        await sendSubcategories(ctx, Msg, platform);
    });

    bot.action(PATTERNS.sub, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardCatalog(ctx))) return;
        const platform = platformFromSlug(ctx.match[1]);
        const sub = subFromSlug(ctx.match[2]);
        await sendServiceList(ctx, Msg, platform, sub, 0);
    });

    bot.action(PATTERNS.list, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardCatalog(ctx))) return;
        const platform = platformFromSlug(ctx.match[1]);
        const sub = subFromSlug(ctx.match[2]);
        const page = parseInt(ctx.match[3], 10) || 0;
        await sendServiceList(ctx, Msg, platform, sub, page);
    });

    bot.action(PATTERNS.view, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardCatalog(ctx))) return;
        const id = parseInt(ctx.match[1], 10);
        await sendServiceDetail(ctx, Msg, id);
    });

    bot.action(PATTERNS.buy, async (ctx) => {
        await safeAnswerCbQuery(ctx, 'Abrindo pedido…');
        if (!(await guardCatalog(ctx))) return;
        const id = parseInt(ctx.match[1], 10);
        await startBuyWizard(ctx, Msg, stateManager, id);
    });

    bot.action(PATTERNS.wizardLink, async (ctx) => {
        await safeAnswerCbQuery(ctx, 'Link…');
        if (!(await guardCatalog(ctx))) return;
        const id = parseInt(ctx.match[1], 10);
        await resumeWizardLink(ctx, Msg, stateManager, id);
    });

    bot.action(PATTERNS.wizardQty, async (ctx) => {
        await safeAnswerCbQuery(ctx, 'Quantidade…');
        if (!(await guardCatalog(ctx))) return;
        const id = parseInt(ctx.match[1], 10);
        await resumeWizardQuantity(ctx, Msg, stateManager, id);
    });

    bot.action(CB.cancelWizard, async (ctx) => {
        await safeAnswerCbQuery(ctx, 'Cancelado');
        await clearWizard(stateManager, ctx.from?.id);
        if (!(await guardCatalog(ctx))) return;
        await sendPlatforms(ctx, Msg);
    });

    bot.action(CB.orders, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardCatalog(ctx))) return;
        await sendUserOrders(ctx, Msg, ctx.from?.id);
    });

    bot.action(PATTERNS.orderView, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardCatalog(ctx))) return;
        const id = parseInt(ctx.match[1], 10);
        await sendOrderDetail(ctx, Msg, id, ctx.from?.id);
    });

    bot.action(PATTERNS.refill, async (ctx) => {
        await safeAnswerCbQuery(ctx, 'Solicitando…');
        if (!(await guardCatalog(ctx))) return;
        if (!(await guardRate(ctx, 'refill', { max: 5, windowSec: 3600 }))) return;
        const id = parseInt(ctx.match[1], 10);
        const result = await SmmOrderService.requestRefill(id, ctx.from?.id);
        if (!result.ok) {
            return smmPanel(ctx, Msg, actionErrorMessage(result.error), actionNoticeKeyboard(id));
        }
        return smmPanel(
            ctx,
            Msg,
            `<b>Reposição solicitada</b>\n\nRefill: <code>${result.refillId}</code>`,
            actionNoticeKeyboard(id)
        );
    });

    bot.action(PATTERNS.cancelAsk, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!(await guardCatalog(ctx))) return;
        const id = parseInt(ctx.match[1], 10);
        return smmPanel(
            ctx,
            Msg,
            '<b>Confirmar cancelamento?</b>\n\nEsta ação não pode ser desfeita.',
            Markup.inlineKeyboard([
                [{ text: L.CONFIRM_CANCEL, callback_data: CB.cancelConfirm(id) }],
                [{ text: L.BACK_ORDER, callback_data: CB.orderView(id) }],
            ])
        );
    });

    bot.action(PATTERNS.cancelConfirm, async (ctx) => {
        await safeAnswerCbQuery(ctx, 'Cancelando…');
        if (!(await guardCatalog(ctx))) return;
        if (!(await guardRate(ctx, 'cancel', { max: 5, windowSec: 3600 }))) return;
        const id = parseInt(ctx.match[1], 10);
        const result = await SmmOrderService.requestCancel(id, ctx.from?.id);
        if (!result.ok) {
            return smmPanel(ctx, Msg, actionErrorMessage(result.error), actionNoticeKeyboard(id));
        }
        return smmPanel(ctx, Msg, '<b>Pedido cancelado</b> com sucesso.', actionNoticeKeyboard(id));
    });

    bot.action(CB.confirmPay, async (ctx) => {
        await safeAnswerCbQuery(ctx, 'Abrindo pagamento…');
        if (!(await guardCatalog(ctx))) return;
        if (!(await guardRate(ctx, 'checkout', { max: 8, windowSec: 300 }))) return;

        const w = await readConfirmWizard(stateManager, ctx.from?.id);
        if (!w) {
            return smmPanel(ctx, Msg, 'Sessão expirada. Escolha o serviço novamente.', catalogNoticeKeyboard());
        }

        const checkoutDeps = {
            cartKey,
            comprasPendentes,
            Menu,
            getAffSaldo,
            getWalletSaldo,
            checkCheckoutCooldown,
            cuponsAplicados,
        };
        const result = await SmmCheckoutService.createPaymentSession(ctx, checkoutDeps, {
            serviceId: w.serviceId,
            link: w.link,
            quantity: w.quantity,
            comments: w.comments || null,
        });

        if (!result.ok) {
            const errKb = checkoutNoticeKeyboard(result.error, w.serviceId);
            if (result.error === 'cooldown') {
                return smmPanel(
                    ctx,
                    Msg,
                    `Aguarde <b>${result.remaining || 30}s</b> antes de outro checkout.`,
                    cooldownNoticeKeyboard()
                );
            }
            if (result.error === 'payment_below_minimum') {
                return smmPanel(
                    ctx,
                    Msg,
                    result.message || checkoutErrorMessage(result.error),
                    errKb
                );
            }
            return smmPanel(
                ctx,
                Msg,
                result.message || checkoutErrorMessage(result.error) || 'Não foi possível criar o pedido.',
                errKb
            );
        }

        await clearWizard(stateManager, ctx.from.id);

        const svc = result.service || CatalogService.getService(w.serviceId);
        const total = result.total;
        const qty = result.quantity ?? w.quantity;
        if (!svc) {
            return smmPanel(ctx, Msg, 'Serviço indisponível. Escolha outro no catálogo.', catalogNoticeKeyboard());
        }

        const { notifyOrderCreated } = require('../helpers/smmUserNotify');
        const botRef = global.botInstance || { telegram: ctx.telegram };
        await notifyOrderCreated(botRef, {
            orderId: result.orderId,
            smmOrderId: result.smmOrderId,
            svc,
            quantity: qty,
            total,
            telegramId: ctx.from?.id,
        }).catch(() => {});

        const affSaldo = getAffSaldo ? await getAffSaldo(ctx.from?.id) : 0;
        const walletSaldo = getWalletSaldo ? await getWalletSaldo(ctx.from?.id) : 0;
        const text = SmmCheckoutService.buildPaymentMessage(
            result.orderId,
            svc,
            qty,
            total,
            affSaldo,
            result.cupomDiscount,
            result.cupomCode,
            walletSaldo
        );
        const kb = SmmCheckoutService.paymentKeyboard(result.orderId, affSaldo, total, Menu, walletSaldo);

        return smmPanel(ctx, Msg, text, kb);
    });

    bot.on('text', async (ctx, next) => {
        if (!isSmmEnabled() || ctx.chat?.type !== 'private') return next();
        if (!(await assertSmmCatalogAccess(ctx, Msg, isAdmin))) return;
        const handled = await handleWizardText(ctx, Msg, stateManager, ctx.message?.text);
        if (handled) return;
        return next();
    });
}

module.exports = { registerSmmCommands };
