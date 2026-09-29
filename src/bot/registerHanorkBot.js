'use strict';

const { correlationContext } = require('../infrastructure');
const tenantContext = require('../infrastructure/TenantContext');
const { resolveForTelegram } = require('../modules/tenant/tenantResolver');
const createMainMiddleware = require('../telegram/middlewares/mainMiddleware');
const createCallbackChecker = require('../telegram/middlewares/antiSpamCallbackMiddleware');
const { registerAdminHandlers, sendProgressPanel, updateAdminPanelMessage } = require('../telegram/commands/admin');
const { createCallbackRouterMiddleware, setCallbackRouterGroupGuard } = require('../telegram/callbacks/router');
const hanorkGateway = require('../core/hanorkGateway');
const { formatTimer } = require('../modules/flash/flashSaleUi');
const { createShowUsers } = require('../telegram/commands/admin/usersHandlers');
const { createBuildGiveawaysPanel } = require('../telegram/commands/admin/giveawayHelpers');
const { buildAdminDeps } = require('./bootstrap/buildAdminDeps');
const { registerPlayCommands } = require('../telegram/commands/playCommands');
const { registerYoutubeCommands } = require('../telegram/commands/youtubeCommands');
const { registerTikTokCommands } = require('../telegram/commands/tiktokCommands');
const { registerInstagramCommands } = require('../telegram/commands/instagramCommands');
const { registerDownloadsCommands, showHub: showDownloadsHub } = require('../telegram/downloads/downloadsHandlers');
const { createCatalogHandlers } = require('../telegram/commands/user/catalogHandlers');
const { createStartSupportFlow } = require('../telegram/commands/user/supportFlow');
const { registerStartHandler } = require('../telegram/commands/user/startHandler');
const { registerAiCommands } = require('../telegram/commands/aiCommands');
const { ROUTER_VERSION } = require('../config/hanork-ai-actions');
const { registerUserCommands } = require('../telegram/commands/user/registerUserCommands');
const { registerProductAdminCommands } = require('../telegram/commands/admin/productCommands');
const { registerFlashGiveawayHandlers } = require('../telegram/commands/user/flashGiveawayHandlers');
const { wireHanorkRouterNative } = require('../services/hanork-ai/wireHanorkRouterNative');
const { registerForwardSpamMiddleware } = require('../telegram/middlewares/forwardSpamMiddleware');
const { registerProductMediaHandler } = require('../telegram/middlewares/productMediaHandler');
const { registerGroupEvents } = require('../telegram/events/groupEvents');
const { registerTextCatchAllHandler } = require('../telegram/middlewares/textCatchAllHandler');
const { BroadcastService } = require('../services/BroadcastService');

/**
 * B3 — middlewares, comandos e handlers Telegram (move-only de bot.js).
 * @returns {{ hanorkRouterNative: object, zeroDivuPlugin: object|null, showCatalog: Function, showCart: Function, openUserCatalog: Function, sendHelpMessage: Function }}
 */
function registerHanorkBot(deps) {
    const {
        bot,
        isGroupChat,
        groupService,
        stateManager,
        prisma,
        antiSpam,
        commandLimiter,
        CONFIG,
        isAdmin,
        upsertGroup,
        upsertGroupMember,
        TEXTO,
        getMaintenanceMode,
        setMaintenanceMode,
        bannedUsers,
        adminActivityNotifier,
        dbRaw,
        Markup,
        ADMIN_HTML,
        Msg,
        Menu,
        logger,
        deferBackground,
        backup,
        broadcastMode,
        addProductMode,
        adminMsgTarget,
        editProductMode,
        giveawayMode,
        autoBroadcastService,
        broadcastService,
        AUTO_BROADCAST_INTERVAL_MS,
        formatBroadcastInterval,
        executeFullBroadcast,
        emailService,
        UserEmailService,
        loadProducts,
        executeBroadcast,
        groupSettings,
        sendAdminPanelWithPhoto,
        editAdminPanel,
        invalidateProductCache,
        invalidateBotUsername,
        carrinhos,
        UserService,
        AuditService,
        sendMainMenu,
        deliverProducts,
        payAffiliateCommission,
        activeChats,
        openTicketChat,
        closeTicketChat,
        ticketCloseKeyboard,
        confirmarSaldoReservado,
        pedirAvaliacao,
        joinChatAwaiting,
        botSession,
        sessionNote,
        syncBusinessLinksFromSettings,
        Cart,
        cartKey,
        replyWithMenuPhoto,
        groupGuard,
        catalogSearchMode,
        getProductById,
        sendProductWithPhoto,
        processAffiliateRef,
        startBuyProduct,
        hanorkAssistMode,
        hanorkRouterContext,
        getCart,
        campanhaEmailMode,
        resgateTentativas,
        runCheckout,
        comprasPendentes,
        cuponsAplicados,
        couponAttemptLimiter,
        supportMode,
        productWizard,
        onboardingStep,
        escapeMd,
        requirePrivate,
        createOrder,
        getAffSaldo,
        getWalletSaldo,
        checkCheckoutCooldown,
        ProductWizardService,
        ProductAdminService,
        buildProductPhotoFileName,
        getVipGroupId,
        getSupportGroupId,
        downloadsGuard,
        bridgePoolService,
        getBotUsername,
        UserAccountCore,
        UserAccountPanels,
        isShopAreaStartPayload,
        resolveShopStartPayload,
        scheduleNewMemberAlerts,
        State,
    } = deps;

    const {
        registerUpdateRecoveryMiddleware,
        startRetryQueueScheduler,
    } = require('../telegram/updateRecovery');
    registerUpdateRecoveryMiddleware(bot);
    startRetryQueueScheduler(bot);

    const { createTelegramEventRouterMiddleware } = require('../telegram/middlewares/telegramEventRouterMiddleware');
    bot.use(createTelegramEventRouterMiddleware({ dbRaw, deferBackground }));

    bot.use(correlationContext.telegrafMiddleware());

    bot.use(async (ctx, next) => {
        if (!bot.botInfo) {
            try {
                bot.botInfo = await bot.telegram.getMe();
            } catch {
                /* getMe falhou — segue; matcher @bot pode falhar até polling estabilizar */
            }
        }
        return next();
    });

    bot.use(async (ctx, next) => {
        if (!isGroupChat(ctx)) return next();
        try {
            const me = bot.botInfo || (await bot.telegram.getMe());
            bot.botInfo = me;
            const member = await bot.telegram.getChatMember(ctx.chat.id, me.id);
            const isAdminBot = ['administrator', 'creator'].includes(member.status) ? 1 : 0;
            upsertGroup(ctx.chat, isAdminBot);
        } catch {
            upsertGroup(ctx.chat, 0);
        }
        return next();
    });

    bot.use(
        tenantContext.middleware(async (ctx) => resolveForTelegram(ctx, { stateManager, prisma }))
    );

    let _checkCallbackWithResponse = null;
    function checkCallbackWithResponse(ctx, action) {
        if (!_checkCallbackWithResponse) {
            _checkCallbackWithResponse = createCallbackChecker(antiSpam, stateManager, CONFIG.ID_DONO);
        }
        return _checkCallbackWithResponse(ctx, action);
    }

    bot.use(createMainMiddleware({
        antiSpam,
        commandLimiter,
        bot,
        stateManager,
        config: CONFIG,
        isAdmin,
        upsertGroup,
        upsertGroupMember,
        isOnboarding: (uid) => {
            const { isOnboarding: fn } = require('../modules/tenant/onboardingHandler');
            return fn(uid);
        },
        handleOnboardingCallback: async (ctx) => {
            const { handleOnboardingCallback: fn } = require('../modules/tenant/onboardingHandler');
            return fn(ctx);
        },
        handleOnboardingMessage: async (ctx) => {
            const { handleOnboardingMessage: fn } = require('../modules/tenant/onboardingHandler');
            return fn(ctx);
        },
        TEXTO,
        getMaintenanceMode,
        bannedUsers,
        adminActivityNotifier,
        isBannedOverride: (uid) => {
            if (bannedUsers.has(uid)) return { banned: true, permanent: true, violation: 'MANUAL' };
            return antiSpam.isBanned(uid);
        },
    }));

    setCallbackRouterGroupGuard({ bot, isAdmin });

    if (hanorkGateway.isFullGatewayEnabled()) {
        bot.use(hanorkGateway.createHanorkGatewayMiddleware());
        hanorkGateway.logGatewayBoot();
    } else {
        bot.use(createCallbackRouterMiddleware());
    }

    let openUserCatalogRef = null;
    const welcomeTourRef = { start: null };

    registerStartHandler(bot, {
        logger, prisma, processAffiliateRef, isGroupChat, groupGuard, bot,
        CONFIG, getProductById, startBuyProduct, sendProductWithPhoto, Msg, deferBackground,
        openUserCatalog: (ctx, opts) => {
            if (!openUserCatalogRef) throw new Error('openUserCatalog not ready');
            return openUserCatalogRef(ctx, opts);
        },
        sendMainMenu, scheduleNewMemberAlerts,
        isShopAreaStartPayload, resolveShopStartPayload,
        isAdmin,
        startWelcomeTour: (ctx) => welcomeTourRef.start?.(ctx),
    });

    const showUsers = createShowUsers({ isAdmin, dbRaw, bannedUsers, Msg, Markup });
    const buildGiveawaysPanel = createBuildGiveawaysPanel({ prisma, dbRaw });

    registerAdminHandlers(bot, buildAdminDeps({
        prisma,
        dbRaw,
        Markup,
        isAdmin,
        ADMIN_HTML,
        Msg,
        Menu,
        logger,
        deferBackground,
        bot,
        bannedUsers,
        antiSpam,
        backup,
        broadcastMode,
        addProductMode,
        adminMsgTarget,
        editProductMode,
        giveawayMode,
        getMaintenanceMode,
        setMaintenanceMode,
        autoBroadcastService,
        broadcastService,
        CONFIG,
        AUTO_BROADCAST_INTERVAL_MS,
        formatBroadcastInterval,
        executeFullBroadcast,
        emailService,
        UserEmailService,
        loadProducts: loadProducts,
        executeBroadcast,
        groupSettings,
        groupService,
        sendAdminPanelWithPhoto,
        editAdminPanel,
        invalidateProductCache,
        invalidateBotUsername,
        formatTimer,
        carrinhos,
        UserService,
        AuditService,
        sendMainMenu,
        deliverProducts,
        payAffiliateCommission,
        showUsers,
        activeChats,
        openTicketChat,
        closeTicketChat,
        ticketCloseKeyboard,
        confirmarSaldoReservado,
        pedirAvaliacao,
        buildGiveawaysPanel,
        joinChatAwaiting,
        botSession,
        sessionNote,
        syncBusinessLinksFromSettings,
    }));

    const playCommandsApi = registerPlayCommands(bot, { Msg, CONFIG, logger, deferBackground, stateManager });
    const youtubeCommandsApi = registerYoutubeCommands(bot, { Msg, CONFIG, logger, deferBackground, stateManager });
    const tiktokCommandsApi = registerTikTokCommands(bot, { Msg, CONFIG, logger, deferBackground, stateManager });
    const instagramCommandsApi = registerInstagramCommands(bot, { Msg, CONFIG, logger, deferBackground, stateManager });
    registerDownloadsCommands(bot, { Msg });

    const hanorkRouterNative = {};
    if (playCommandsApi?.handlePlayQuery) {
        hanorkRouterNative.runPlayQuery = (ctx, input, opts) =>
            playCommandsApi.handlePlayQuery(ctx, input, opts);
    }
    if (youtubeCommandsApi?.handleYoutubeQuery) {
        hanorkRouterNative.runYoutubeQuery = (ctx, input, opts) =>
            youtubeCommandsApi.handleYoutubeQuery(ctx, input, opts);
    }
    if (tiktokCommandsApi?.handleTikTokQuery) {
        hanorkRouterNative.runTikTokQuery = (ctx, input, opts) =>
            tiktokCommandsApi.handleTikTokQuery(ctx, input, opts);
    }
    if (instagramCommandsApi?.handleInstagramQuery) {
        hanorkRouterNative.runInstagramQuery = (ctx, input, opts) =>
            instagramCommandsApi.handleInstagramQuery(ctx, input, opts);
    }

    const catalogApi = createCatalogHandlers({
        loadProducts: loadProducts,
        Msg,
        Markup,
        prisma,
        Cart,
        cartKey,
        replyWithMenuPhoto,
        TEXTO,
        isGroupChat,
        groupGuard,
        bot,
        botSession,
        sessionNote,
        catalogSearchMode,
        checkCallbackWithResponse,
        requirePrivate,
        getProductById,
        sendProductWithPhoto,
        antiSpam,
    });
    const openUserCatalog = catalogApi.openUserCatalog;
    openUserCatalogRef = openUserCatalog;
    const showCatalog = catalogApi.showCatalog;
    const showCart = catalogApi.showCart;

    hanorkRouterNative.openDownloadsHub = showDownloadsHub;
    hanorkRouterNative.processCheckout = (ctx) => runCheckout(ctx);
    hanorkRouterNative.openAdminPanel = async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return;
        await sendMainMenu(ctx, false);
    };
    hanorkRouterNative.openWhatsAppPanel = async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return;
        await Msg.reply(
            ctx,
            '<b>WhatsApp · Zero Divu</b>\n\nGerencie conexão, campanhas e publicações pelo painel administrativo.',
            Markup.inlineKeyboard([[{ text: '📱 Abrir painel WhatsApp', callback_data: 'a_wa_menu' }]]),
            { parse_mode: 'HTML' }
        );
    };
    hanorkRouterNative.openBroadcastPanel = async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return;
        await Msg.reply(
            ctx,
            '<b>Divulgação</b>\n\nConfigure envios e campanhas no painel admin.',
            Markup.inlineKeyboard([[{ text: '📣 Abrir divulgação', callback_data: 'a_cmd_divulgacao' }]]),
            { parse_mode: 'HTML' }
        );
    };

    const startSupportFlow = createStartSupportFlow({ Msg, Markup, activeChats, botSession, supportMode, sessionNote });

    const hanorkAssistantApi = registerAiCommands(bot, {
        Msg,
        CONFIG,
        isAdmin,
        loadProducts: loadProducts,
        logger,
        hanorkAssistMode,
        hanorkRouterContext,
        editProductMode,
        productWizard,
        broadcastMode,
        getCart: getCart || ((chatId) => State.getCart(chatId)),
        botSession,
        sessionNote,
        activeChats,
        startSupportFlow: (ctx) => startSupportFlow(ctx),
        sendProductWithPhoto,
        openUserCatalog,
        showCart,
        commandLimiter,
        supportMode,
        native: hanorkRouterNative,
        stateManager,
    });

    let zeroDivuPlugin = null;
    try {
        const { initZeroDivuPlugin } = require('../plugins/zero-divu');
        zeroDivuPlugin = initZeroDivuPlugin(bot, {
            isAdmin,
            Msg,
            Markup,
            logger,
            adminActivityNotifier,
            editAdminPanel,
            deferBackground: require('../utils/defer').deferBackground,
            loadProducts: loadProducts,
            prisma,
            broadcastService,
            executeFullBroadcast,
            runBridgePromoAfterBot: (payload) => autoBroadcastService.runBridgePromoAfterBot(payload),
            BroadcastService,
            sendProgressPanel,
            updateAdminPanelMessage,
            CONFIG,
            getBotUsername,
            photosDir: CONFIG.CAMINHO_FOTOS,
            autoBroadcastService,
        });
    } catch (e) {
        if (require('../plugins/zero-divu/config').isZeroDivuEnabled()) {
            logger.error('[ZeroDivu] Falha ao carregar plugin:', {
                message: e.message,
                stack: e.stack?.split('\n').slice(0, 5).join('\n'),
            });
            try {
                const logBridge = require('../plugins/zero-divu').registerZeroDivuHandlers(bot, {
                    isAdmin,
                    Msg,
                    Markup,
                    logger,
                    adminActivityNotifier,
                    editAdminPanel,
                    deferBackground: require('../utils/defer').deferBackground,
                    loadProducts: loadProducts,
                    prisma,
                    broadcastService,
                    autoBroadcastService,
                    executeFullBroadcast,
                    runBridgePromoAfterBot: (payload) => autoBroadcastService.runBridgePromoAfterBot(payload),
                    BroadcastService,
                    sendProgressPanel,
                    updateAdminPanelMessage,
                    CONFIG,
                });
                zeroDivuPlugin = { logBridge, partial: true };
                logger.warn('[ZeroDivu] Painel WhatsApp registrado em modo degradado');
            } catch (e2) {
                logger.error('[ZeroDivu] Fallback painel WA falhou:', e2.message);
            }
        }
    }

    try {
        const { refreshRules, getRules } = require('../services/hanork-ai/HanorkUniversalRegistry');
        refreshRules();
        logger.info(
            `[HanorkRouter] v${ROUTER_VERSION} universal — ${getRules().length} rotas (comandos + painéis + WA), modo silencioso`
        );
    } catch (e) {
        logger.warn('[HanorkRouter] catálogo universal:', e.message);
    }

    const userCmdApi = registerUserCommands(bot, {
        bot,
        isGroupChat,
        groupGuard,
        CONFIG,
        isAdmin,
        requirePrivate,
        cartKey,
        Cart,
        Msg,
        Markup,
        prisma,
        replyWithMenuPhoto,
        TEXTO,
        runCheckout,
        comprasPendentes,
        logger,
        dbRaw,
        resgateTentativas,
        loadProducts: loadProducts,
        botSession,
        sessionNote,
        Menu,
        cuponsAplicados,
        couponAttemptLimiter,
        hanorkRouterNative,
        campanhaEmailMode,
        hanorkAssistantApi,
        supportMode,
        hanorkAssistMode,
        broadcastMode,
        productWizard,
        editProductMode,
        joinChatAwaiting,
        giveawayMode,
        adminMsgTarget,
        catalogSearchMode,
        onboardingStep,
        stateManager,
        sendMainMenu,
        escapeMd,
        getProductById,
        sendProductWithPhoto,
        deliverProducts,
    });

    welcomeTourRef.start = userCmdApi.startWelcomeTour;

    const sendHelpMessage = userCmdApi.sendHelpMessage;

    catalogApi.registerCatalogRoutes(bot);

    registerProductAdminCommands(bot, {
        isAdmin,
        Msg,
        Markup,
        prisma,
        botSession,
        sessionNote,
        openProductAdminPanelWithCleanSessions: deps.openProductAdminPanelWithCleanSessions,
        beginProductFieldEdit: deps.beginProductFieldEdit,
        productAdminDeps: deps.productAdminDeps,
        productWizard,
        wizardDeps: deps.wizardDeps,
        dbRaw,
        beginProductCreateFlow: deps.beginProductCreateFlow,
    });

    const flashGiveawayApi = registerFlashGiveawayHandlers(bot, {
        isAdmin,
        Msg,
        Markup,
        Menu,
        prisma,
        dbRaw,
        logger,
        bot,
        CONFIG,
        antiSpam,
        deferBackground,
        autoBroadcastService,
        broadcastService,
        replyWithMenuPhoto,
        getProductById,
        loadProducts: loadProducts,
        cartKey,
        comprasPendentes,
        getAffSaldo,
        createOrder,
    });
    hanorkRouterNative.openFlashSales = flashGiveawayApi.openFlashSalesPanel;
    hanorkRouterNative.openGiveaway = flashGiveawayApi.openGiveawayPanel;

    wireHanorkRouterNative(hanorkRouterNative, {
        bot,
        Msg,
        Markup,
        CONFIG,
        logger,
        prisma,
        loadProducts: loadProducts,
        broadcastService,
        autoBroadcastService,
        broadcastMode,
        botSession,
        sessionNote,
        groupService,
        groupSettings,
        isAdmin,
        deferBackground,
        productAdminDeps: deps.productAdminDeps,
        isGroupChat,
        groupGuard,
        sendHelpMessage,
        replyWithMenuPhoto,
        openUserCatalog,
        UserAccountCore,
        UserAccountPanels,
    });

    registerForwardSpamMiddleware(bot, { Msg, isAdmin, productWizard, ProductWizardService, editProductMode });

    registerProductMediaHandler(bot, {
        isAdmin, editProductMode, ProductWizardService, ProductAdminService,
        buildProductPhotoFileName, productAdminDeps: deps.productAdminDeps, wizardDeps: deps.wizardDeps, productWizard,
        CONFIG, Msg, Markup, logger, activeChats, prisma, bot,
    });

    registerGroupEvents(bot, {
        CONFIG, logger, dbRaw, Markup, loadProducts: loadProducts, getVipGroupId, bot,
        upsertGroup, upsertGroupMember,
    });

    try {
        const { registerSmmCommands } = require('../modules/smm/commands/registerSmmCommands');
        registerSmmCommands(bot, {
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
        });
    } catch (e) {
        logger.warn('[SMM] Telegram handlers skip', { detail: e.message });
    }

    try {
        const { registerVirtuoCommands } = require('../modules/virtuo/commands/registerVirtuoCommands');
        registerVirtuoCommands(bot, {
            Msg,
            isAdmin,
            requirePrivate,
            cartKey,
            comprasPendentes,
            Menu,
            getAffSaldo,
            getWalletSaldo,
            checkCheckoutCooldown,
            cuponsAplicados,
        });
    } catch (e) {
        logger.warn('[Virtuo] Telegram handlers skip', { detail: e.message });
    }

    try {
        const { registerWaDivulgacaoAdminCommands } = require('../modules/wa-divulgacao/commands/waDivulgacaoAdminCommands');
        const { registerWaDivulgacaoAdminPanel } = require('../modules/wa-divulgacao/handlers/waDivulgacaoAdminPanel');
        registerWaDivulgacaoAdminCommands(bot, { isAdmin, Msg });
        registerWaDivulgacaoAdminPanel(bot, { isAdmin, Msg, editAdminPanel });
    } catch (e) {
        logger.warn('[WaDivulgacao] Admin handlers skip', { detail: e.message });
    }

    registerTextCatchAllHandler(bot, {
        Msg, Markup, Menu, logger, prisma, dbRaw, isAdmin, deferBackground,
        productWizard, ProductWizardService, editProductMode, ProductAdminService,
        productAdminDeps: deps.productAdminDeps, wizardDeps: deps.wizardDeps, activeChats,
        joinChatAwaiting, groupService, bridgePoolService, broadcastMode,
        campanhaEmailMode, catalogSearchMode, supportMode, hanorkAssistMode,
        hanorkAssistantApi, adminMsgTarget, UserEmailService, loadProducts: loadProducts,
        sendProductWithPhoto, openUserCatalog, downloadsGuard, hanorkRouterNative, groupGuard,
        isGroupChat,
        isOnboarding: (uid) => {
            const { isOnboarding: fn } = require('../modules/tenant/onboardingHandler');
            return fn(uid);
        },
        CONFIG, ADMIN_HTML, broadcastService, autoBroadcastService, executeFullBroadcast,
        getVipGroupId, getSupportGroupId, escapeMd, ticketCloseKeyboard,
        stateManager, correlationContext, tenantContext, getBotUsername,
    });

    return {
        hanorkRouterNative,
        zeroDivuPlugin,
        showCatalog,
        showCart,
        openUserCatalog,
        sendHelpMessage,
    };
}

module.exports = { registerHanorkBot };
