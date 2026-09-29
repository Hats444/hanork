'use strict';

const { isVirtuoEnabled } = require('../virtuoEnabled');
const { CB } = require('../utils/virtuoCallbackData');
const { sendHome, sendCountries, sendConfirm, sendUserOrders, promptCountrySearch } = require('../handlers/virtuoUiHandlers');
const { assertVirtuoCatalogAccess } = require('../virtuoAccess');
const { virtuoPanel } = require('../helpers/virtuoPanelUi');
const VirtuoCheckoutService = require('../services/checkoutService');
const VirtuoCatalogService = require('../services/catalogService');
const { safeAnswerCbQuery } = require('../../../utils/safeTelegram');
const { apiErrorToUser } = require('../utils/virtuoTextFormat');
const L = require('../utils/virtuoLabels');
const { requireBotContext } = require('../../../telegram/callbacks/BotContext');
const { runSyncCatalogJob } = require('../jobs/syncCatalogJob');
const VirtuoOrderRepository = require('../repositories/virtuoOrderRepository');
const VirtuoFulfillmentService = require('../services/fulfillmentService');
const { refreshOrderPanel } = require('../helpers/virtuoUserNotify');
const VirtuoBalanceService = require('../services/virtuoBalanceService');
const {
    fetchUnifiedSupplierSnapshot,
    buildAllSuppliersHtml,
} = require('../../../services/unifiedSupplierBalance');
const { formatMoney } = require('../utils/virtuoTextFormat');
const { getDocsPage, docsKeyboard, buildDocsIntroHtml, DOCS_PATH } = require('../utils/virtuoApiDocs');
const { sendVirtuoDocsPage } = require('../commands/virtuoAdminCommands');
const fs = require('fs');
const logger = require('../../../config/logger');
const { denySilent, denyCbSilent } = require('../../../utils/silencedAccess');

function virtuoDeps() {
    return requireBotContext([
        'Msg',
        'isAdmin',
        'requirePrivate',
        'cartKey',
        'comprasPendentes',
        'Menu',
        'getAffSaldo',
        'getWalletSaldo',
        'checkCheckoutCooldown',
        'cuponsAplicados',
    ]);
}

async function guardPrivate(ctx) {
    const { requirePrivate } = virtuoDeps();
    if (requirePrivate && !(await requirePrivate(ctx))) return false;
    return true;
}

async function guardCatalog(ctx) {
    if (!(await guardPrivate(ctx))) return false;
    const { Msg, isAdmin } = virtuoDeps();
    return assertVirtuoCatalogAccess(ctx, Msg, isAdmin);
}

function disabled() {
    return !isVirtuoEnabled();
}

const VirtuoHandlers = {
    [CB.HOME]: async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (disabled()) {
            const { Msg } = virtuoDeps();
            return virtuoPanel(
                ctx,
                Msg,
                '<b>📱 Números SMS</b>\n\n' +
                    'Serviço temporariamente indisponível.\n\n' +
                    '<i>Admin: configure <code>VIRTUO_ENABLED=1</code> e <code>VIRTUO_API_KEY</code> no .env e reinicie o bot.</i>',
                {
                    inline_keyboard: [
                        [{ text: L.MENU, callback_data: 'menu:home' }],
                    ],
                }
            );
        }
        if (!(await guardCatalog(ctx))) return;
        const { Msg } = virtuoDeps();
        await sendHome(ctx, Msg);
    },

    'virtuo:svc:*': async (ctx, [code]) => {
        if (disabled()) return;
        await safeAnswerCbQuery(ctx, 'Carregando…');
        if (!(await guardCatalog(ctx))) return;
        const { Msg } = virtuoDeps();
        await sendCountries(ctx, Msg, String(code || '').toLowerCase(), 0);
    },

    'virtuo:ctyp:*': async (ctx, [serviceCode, page]) => {
        if (disabled()) return;
        await safeAnswerCbQuery(ctx, 'Carregando…');
        if (!(await guardCatalog(ctx))) return;
        const { Msg } = virtuoDeps();
        await sendCountries(ctx, Msg, serviceCode, parseInt(page, 10) || 0);
    },

    'virtuo:srch:*': async (ctx, [scope]) => {
        if (disabled()) return;
        await safeAnswerCbQuery(ctx);
        if (!(await guardCatalog(ctx))) return;
        const { Msg } = virtuoDeps();
        await promptCountrySearch(ctx, Msg, String(scope || 'hub').toLowerCase());
    },

    'virtuo:quick:*': async (ctx) => {
        if (disabled()) return;
        await safeAnswerCbQuery(ctx, 'Use Buscar ou /numeros app país');
        if (!(await guardCatalog(ctx))) return;
        const { Msg } = virtuoDeps();
        const { promptGlobalSearch } = require('../handlers/virtuoUiHandlers');
        await promptGlobalSearch(ctx, Msg);
    },

    'virtuo:cty:*': async (ctx, [serviceId, page]) => {
        if (disabled()) return;
        await safeAnswerCbQuery(ctx);
        if (!(await guardCatalog(ctx))) return;
        const { Msg } = virtuoDeps();
        await sendConfirm(ctx, Msg, parseInt(serviceId, 10), page != null ? parseInt(page, 10) : 0);
    },

    'virtuo:buy:*': async (ctx, params) => {
        if (disabled()) return;
        await safeAnswerCbQuery(ctx, 'Abrindo pagamento…');
        if (!(await guardCatalog(ctx))) return;

        const expectedService = params.length >= 2 ? String(params[0]).toLowerCase() : null;
        const serviceId = parseInt(params[params.length >= 2 ? 1 : 0], 10);
        const { cartKey, comprasPendentes, Menu, getAffSaldo, getWalletSaldo, checkCheckoutCooldown, cuponsAplicados, Msg } =
            virtuoDeps();

        const result = await VirtuoCheckoutService.createPaymentSession(
            ctx,
            { cartKey, comprasPendentes, Menu, getAffSaldo, getWalletSaldo, checkCheckoutCooldown, cuponsAplicados },
            { serviceId, expectedServiceCode: expectedService }
        );

        if (!result.ok) {
            const msg = result.message || apiErrorToUser(result.error);
            const svcRow = VirtuoCatalogService.getService(serviceId);
            const backCb = svcRow ? CB.countriesPage(svcRow.service_code, 0) : CB.HOME;
            const backLabel = svcRow ? L.COUNTRIES : L.APPS;
            return virtuoPanel(ctx, Msg, `<b>Não foi possível continuar</b>\n\n${msg}`, {
                inline_keyboard: [[{ text: backLabel, callback_data: backCb }]],
            });
        }

        const svc = result.service || VirtuoCatalogService.getService(serviceId);
        const affSaldo = getAffSaldo ? await getAffSaldo(ctx.from?.id) : 0;
        const walletSaldo = getWalletSaldo ? await getWalletSaldo(ctx.from?.id) : 0;
        const text = VirtuoCheckoutService.buildPaymentMessage(
            result.orderId,
            svc,
            result.total,
            affSaldo,
            result.cupomDiscount,
            result.cupomCode,
            walletSaldo
        );
        const kb = VirtuoCheckoutService.paymentKeyboard(result.orderId, affSaldo, result.total, Menu, walletSaldo);
        return virtuoPanel(ctx, Msg, text, kb);
    },

    [CB.orders]: async (ctx) => {
        if (disabled()) return;
        await safeAnswerCbQuery(ctx);
        if (!(await guardCatalog(ctx))) return;
        const { Msg } = virtuoDeps();
        await sendUserOrders(ctx, Msg, ctx.from?.id);
    },

    'virtuo:noop': async (ctx) => safeAnswerCbQuery(ctx),

    [CB.sync]: async (ctx) => {
        if (disabled()) return;
        const { isAdmin, Msg } = virtuoDeps();
        if (!isAdmin?.(ctx.from?.id)) {
            await denyCbSilent('virtuo_admin', ctx);
            return;
        }
        await ctx.answerCbQuery('Sincronizando…').catch(() => {});
        const result = await runSyncCatalogJob();
        const detail = result.ok ? `${result.upserted} ofertas` : result.error;
        logger.info('[Virtuo] sync manual', result);
        return virtuoPanel(
            ctx,
            Msg,
            result.ok
                ? `<b>✅ Catálogo atualizado</b>\n\n${detail}`
                : `<b>❌ Sync falhou</b>\n\n${detail}`,
            { inline_keyboard: [[{ text: L.APPS, callback_data: CB.HOME }]] }
        );
    },

    'virtuo:bal:refresh': async (ctx) => {
        if (disabled()) return;
        const { isAdmin, Msg } = virtuoDeps();
        if (!isAdmin?.(ctx.from?.id)) {
            await denyCbSilent('virtuo_admin', ctx);
            return;
        }
        await ctx.answerCbQuery('Consultando saldos…').catch(() => {});
        const snapshot = await fetchUnifiedSupplierSnapshot();
        if (!snapshot.ok) {
            return Msg.reply(ctx, '❌ Nenhum fornecedor respondeu.');
        }
        const html = buildAllSuppliersHtml(snapshot.rows, { showOkHint: true });
        try {
            await ctx.editMessageText(html, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                ...VirtuoBalanceService.adminBalanceKeyboard(),
            });
        } catch {
            await Msg.reply(ctx, html, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                ...VirtuoBalanceService.adminBalanceKeyboard(),
            });
        }
    },

    'virtuo:bal:stats': async (ctx) => {
        if (disabled()) return;
        const { isAdmin, Msg } = virtuoDeps();
        if (!isAdmin?.(ctx.from?.id)) {
            await denyCbSilent('virtuo_admin', ctx);
            return;
        }
        await ctx.answerCbQuery().catch(() => {});
        const apps = VirtuoCatalogService.listFeaturedApps();
        const orders = VirtuoOrderRepository.stats();
        await Msg.reply(
            ctx,
            `📊 <b>Virtuo SMS — rápido</b>\n\n` +
                `📱 ${apps.length} app(s) no catálogo\n` +
                `🛒 ${orders.total || 0} pedido(s)\n` +
                `⏳ ${orders.waiting || 0} aguardando SMS\n` +
                `💵 Lucro: <b>${formatMoney(orders.profit || 0)}</b>`,
            { parse_mode: 'HTML' }
        );
    },

    'virtuo:ordrf:*': async (ctx, [virtuoOrderId]) => {
        if (disabled()) return;
        await safeAnswerCbQuery(ctx, 'Atualizando…');
        const bot = global.botInstance || { telegram: ctx.telegram };
        const order = VirtuoOrderRepository.findById(parseInt(virtuoOrderId, 10));
        if (!order || String(order.telegram_id) !== String(ctx.from?.id)) {
            return ctx.answerCbQuery('Pedido não encontrado', { show_alert: true }).catch(() => {});
        }
        if (order.status === 'waiting_sms' && order.virtuo_order_id) {
            await VirtuoFulfillmentService.pollActivation(order, bot);
            const fresh = VirtuoOrderRepository.findById(order.id);
            await refreshOrderPanel(bot, fresh || order);
            return;
        }
        await refreshOrderPanel(bot, order);
    },

    'virtuo:ordcp:*': async (ctx, [virtuoOrderId]) => {
        if (disabled()) return;
        const order = VirtuoOrderRepository.findById(parseInt(virtuoOrderId, 10));
        if (!order?.phone || String(order.telegram_id) !== String(ctx.from?.id)) {
            return ctx.answerCbQuery('Número indisponível', { show_alert: true }).catch(() => {});
        }
        await ctx.answerCbQuery(`📞 ${order.phone}`, { show_alert: true }).catch(() => {});
    },

    'virtuo:ordcc:*': async (ctx, [virtuoOrderId]) => {
        if (disabled()) return;
        const order = VirtuoOrderRepository.findById(parseInt(virtuoOrderId, 10));
        if (!order?.sms_code || String(order.telegram_id) !== String(ctx.from?.id)) {
            return ctx.answerCbQuery('Código indisponível', { show_alert: true }).catch(() => {});
        }
        await ctx.answerCbQuery(`🔢 ${order.sms_code}`, { show_alert: true }).catch(() => {});
    },

    'virtuo:docs:*': async (ctx, [arg]) => {
        const { isAdmin, Msg } = virtuoDeps();
        if (!isAdmin?.(ctx.from?.id)) {
            await denyCbSilent('virtuo_admin', ctx);
            return;
        }
        await safeAnswerCbQuery(ctx);

        if (arg === 'file') {
            return ctx
                .replyWithDocument({ source: fs.createReadStream(DOCS_PATH), filename: 'virtuo-esim-api-docs.md' })
                .catch(() => Msg.reply(ctx, '❌ Não foi possível enviar o arquivo de documentação.'));
        }

        const page = getDocsPage(parseInt(arg, 10) || 0);
        const text = `${buildDocsIntroHtml()}\n\n${page.html}`.slice(0, 4096);
        const kb = docsKeyboard(page.index, page.total);
        try {
            await ctx.editMessageText(text, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                ...kb,
            });
        } catch {
            await sendVirtuoDocsPage(ctx, Msg, page.index);
        }
    },
};

module.exports = { VirtuoHandlers };
