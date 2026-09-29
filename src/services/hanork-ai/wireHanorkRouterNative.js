'use strict';

/**
 * Pontes Hanork AI Router — comandos nativos, admin, help/conta/favoritos.
 * @param {object} native — objeto mutável hanorkRouterNative
 * @param {object} deps
 */
function wireHanorkRouterNative(native, deps) {
    const {
        bot,
        Msg,
        Markup,
        CONFIG,
        logger,
        prisma,
        loadProducts,
        broadcastService,
        autoBroadcastService,
        broadcastMode,
        botSession,
        sessionNote,
        groupService,
        groupSettings,
        isAdmin,
        deferBackground,
        productAdminDeps,
        isGroupChat,
        groupGuard,
        sendHelpMessage,
        replyWithMenuPhoto,
        openUserCatalog,
        UserAccountCore,
        UserAccountPanels,
    } = deps;

    const AdminNative = require('./HanorkAdminNative');
    const adminDeps = () => ({
        Msg,
        CONFIG,
        logger,
        prisma,
        loadProducts,
        broadcastService,
        autoBroadcastService,
        broadcastMode,
        botSession,
        sessionNote,
        groupService,
        groupSettings,
        isAdmin,
        deferBackground,
        botUsername: bot.botInfo?.username,
    });

    native.enterBroadcastGroupsMode = (ctx) => AdminNative.enterBroadcastGroupsMode(ctx, adminDeps());
    native.enterBroadcastIaMode = (ctx) => AdminNative.enterBroadcastIaMode(ctx, adminDeps());
    native.enterBroadcastTextMode = (ctx) => AdminNative.enterBroadcastTextMode(ctx, adminDeps());
    native.openBroadcastProductPicker = (ctx) => AdminNative.openBroadcastProductPicker(ctx, adminDeps());
    native.runBroadcastFullNow = (ctx, opts) => AdminNative.runBroadcastFullNow(ctx, adminDeps(), opts);
    native.runGroupBroadcastNow = (ctx, opts) => AdminNative.runGroupBroadcastNow(ctx, adminDeps(), opts);
    native.runChannelBroadcastNow = (ctx, opts) => AdminNative.runChannelBroadcastNow(ctx, adminDeps(), opts);
    native.openAdminCallback = (ctx, cb, cap) => AdminNative.openAdminCallback(ctx, adminDeps(), cb, cap);

    const productAdminRouterDeps = () => ({
        ...adminDeps(),
        getProductAdminDeps: (c) => productAdminDeps(c),
    });
    native.applyProductPriceUpdate = (ctx, params) =>
        AdminNative.applyProductPriceUpdate(ctx, productAdminRouterDeps(), params);
    native.applyProductFieldUpdate = (ctx, params) =>
        AdminNative.applyProductFieldUpdate(ctx, productAdminRouterDeps(), params);
    native.applyProductPause = (ctx, params) =>
        AdminNative.applyProductPause(ctx, productAdminRouterDeps(), params);
    native.applyProductReactivate = (ctx, params) =>
        AdminNative.applyProductReactivate(ctx, productAdminRouterDeps(), params);

    const HanorkCommandDispatch = require('./HanorkCommandDispatch');
    native.dispatchSlash = (ctx, slash, args) => HanorkCommandDispatch.dispatchSlash(bot, ctx, slash, args);
    native.dispatchCallback = (ctx, cb, cap) =>
        HanorkCommandDispatch.dispatchCallback(bot, ctx, cb, cap);

    native.runHelp = async (ctx) => {
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        if (isGroupChat(ctx)) {
            return groupGuard.sendGroupWelcome(ctx, bot, { supportUrl: CONFIG.CONTATO_ESPECIALISTA });
        }
        return sendHelpMessage(ctx, 'all');
    };
    native.runAccount = async (ctx) => {
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        const summary = await UserAccountCore.getAccountSummary(ctx.from.id);
        if (!summary) return replyWithMenuPhoto(ctx, '❌ Faça /start primeiro.');
        return replyWithMenuPhoto(
            ctx,
            UserAccountPanels.buildMeusDadosText(summary),
            UserAccountPanels.meusDadosKeyboard(!!summary.subscription)
        );
    };
    native.runFavorites = async (ctx) => {
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        if (!user) return replyWithMenuPhoto(ctx, '❌ Faça /start primeiro.');
        const favIds = await prisma.favorite.findByUser(user.id);
        if (!favIds.length) {
            return replyWithMenuPhoto(
                ctx,
                '❤️ Você não tem favoritos ainda.\n\nAdicione produtos na ficha do item.',
                Markup.inlineKeyboard([[{ text: '📂 Catálogo', callback_data: 'cat' }]])
            );
        }
        return openUserCatalog(ctx, { mode: 'list', page: 0, query: '' });
    };
}

module.exports = { wireHanorkRouterNative };
