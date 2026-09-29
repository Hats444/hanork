'use strict';

const { registry } = require('../../core/CallbackRegistry');
const { dispatcher } = require('../../core/CallbackDispatcher');
const { errorHandler } = require('../../core/ErrorHandler');
const { AllHandlers } = require('../../core/UserHandlers');
const { setBotContext, requireBotContext } = require('./BotContext');
const {
    normalizeCallbackData,
    delegatePaymentNamespaceToLegacy,
} = require('./legacyPatterns');
const {
    validationMiddleware,
    debounceMiddleware,
    auditMiddleware,
} = require('../middlewares/callbackPipeline');
const logger = require('../../config/logger');
const CheckoutService = require('../../services/CheckoutService');
const AffiliatePaymentService = require('../../services/AffiliatePaymentService');
const { CB } = require('./constants');
const { safeAnswerCbQuery } = require('../../utils/safeTelegram');
const { markCallbackRouterReady, setCallbackRouterGroupGuard } = require('./router');
const hanorkGateway = require('../../core/hanorkGateway');

function buildContextHandlers() {
    return {
        [CB.MENU_HOME]: async (ctx) => {
            const { sendMainMenu } = requireBotContext(['sendMainMenu']);
            await safeAnswerCbQuery(ctx);
            await sendMainMenu(ctx);
        },
        [CB.CATALOG_VIEW]: async (ctx) => {
            const { showCatalog } = requireBotContext(['showCatalog']);
            await safeAnswerCbQuery(ctx);
            await showCatalog(ctx);
        },
        [CB.CART_VIEW]: async (ctx) => {
            const { showCart } = requireBotContext(['showCart']);
            await safeAnswerCbQuery(ctx);
            await showCart(ctx);
        },
        [CB.CART_CLEAR]: async (ctx) => {
            const { Cart, cartKey, sendMainMenu } = requireBotContext(['Cart', 'cartKey', 'sendMainMenu']);
            await safeAnswerCbQuery(ctx, '🗑️ Esvaziado');
            await Cart.clear(cartKey(ctx));
            await sendMainMenu(ctx);
        },
        [CB.CHECKOUT_START]: async (ctx) => {
            const deps = requireBotContext([
                'cartKey', 'Cart', 'createOrder', 'prisma', 'comprasPendentes',
                'getAffSaldo', 'getWalletSaldo', 'checkCheckoutCooldown', 'Menu', 'Markup', 'Msg', 'cuponsAplicados',
            ]);
            await safeAnswerCbQuery(ctx, '💳 Preparando...');
            if (ctx.callbackQuery?.message) {
                try {
                    await deps.Msg.edit(
                        ctx,
                        '⏳ <b>Preparando seu checkout...</b>\n\n<i>Aguarde alguns segundos.</i>',
                        deps.Markup.inlineKeyboard([
                            [{ text: '⏳ Processando...', callback_data: CB.CHECKOUT_PROCESSING }],
                        ]),
                        { parse_mode: 'HTML' }
                    );
                } catch {
                    /* mensagem pode ser foto — segue checkout */
                }
            }
            await CheckoutService.processCheckout(ctx, deps);
        },
        [CB.CHECKOUT_PROCESSING]: async (ctx) => {
            await safeAnswerCbQuery(ctx, '⏳ Checkout em andamento...');
        },
        'payment:aff:*': async (ctx, [orderId]) => {
            const deps = requireBotContext([
                'cartKey', 'comprasPendentes', 'prisma', 'Markup', 'Msg',
                'deliverProducts', 'payAffiliateCommission',
            ]);
            await AffiliatePaymentService.processAffiliatePayment(ctx, orderId, deps);
        },
        'payment:wallet:*': async (ctx, [orderId]) => {
            const WalletPaymentService = require('../../services/WalletPaymentService');
            const deps = requireBotContext([
                'cartKey', 'comprasPendentes', 'prisma', 'Markup', 'Msg',
            ]);
            await WalletPaymentService.processWalletPayment(ctx, orderId, deps);
        },
    };
}

function setupCallbackSystem(bot, deps, adminIds = []) {
    setBotContext(deps);
    if (deps.isAdmin) {
        setCallbackRouterGroupGuard({ bot: deps.bot || bot, isAdmin: deps.isAdmin });
    }
    registry.clear();
    registry.use(validationMiddleware());
    registry.use(debounceMiddleware(deps.stateManager, adminIds));
    registry.use(auditMiddleware());

    const merged = { ...AllHandlers, ...buildContextHandlers() };
    for (const [pattern, handler] of Object.entries(merged)) {
        registry.register(pattern, handler);
    }

    const { LegacyMapping } = require('../../core/UserHandlers');
    for (const [legacy, target] of Object.entries(LegacyMapping)) {
        registry.register(
            legacy,
            async (ctx) => {
                ctx.callbackQuery.data = target;
                return registry.dispatch(ctx);
            },
            { legacyAlias: true }
        );
    }

    registry.setFallback(async (ctx, data) => {
        logger.warn('[CallbackSetup] unhandled in registry (legacy may handle)', {
            data,
            userId: ctx.from?.id,
        });
    });

    bot.use(errorHandler.globalErrorHandler());
    if (hanorkGateway.isFullGatewayEnabled()) {
        hanorkGateway.markHanorkGatewayReady();
    } else {
        markCallbackRouterReady();
    }
    logger.info('[CallbackSetup] ready', {
        handlers: Object.keys(merged).length,
        gateway: hanorkGateway.isFullGatewayEnabled(),
    });
}

module.exports = { setupCallbackSystem };
