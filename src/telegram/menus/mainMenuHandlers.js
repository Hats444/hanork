'use strict';

/**
 * B3 — menu principal, fotos de produto e alertas de novo membro.
 */
function createMainMenuHandlers(deps) {
    const {
        bot,
        CONFIG,
        logger,
        prisma,
        dbRaw,
        Menu,
        Msg,
        Markup,
        TEXTO,
        isAdmin,
        isGroupChat,
        groupGuard,
        loadProducts,
        sessionNote,
        deferBackground,
        sendAdminPanelWithPhoto,
        ADMIN_HTML,
        getMaintenanceMode,
        getVipGroupId,
        getProductById,
        Cart,
        cartKey,
        stateManager,
    } = deps;

    async function resolveFeaturedProduct(products = []) {
        const featuredId = parseInt(process.env.BOT_FEATURED_PRODUCT_ID || '', 10);
        if (!(featuredId > 0)) return null;
        let fp = products.find((p) => Number(p.id) === featuredId);
        if (!fp) {
            try {
                fp = await getProductById(featuredId);
            } catch { /* ignore */ }
        }
        if (!fp?.name) return null;
        const price = Number(fp.price || 0).toFixed(2);
        const { featuredViewBtn } = require('../../utils/buttonLabels');
        return {
            id: featuredId,
            name: fp.name,
            price,
            menuLabel: featuredViewBtn(fp.price),
            callbackData: `p_${featuredId}`,
        };
    }

    async function buildFeaturedProductLine(products = []) {
        const featured = await resolveFeaturedProduct(products);
        if (!featured) return '';
        const buyLabel = featured.menuLabel;
        return (
            `\n\n<b>Produto em destaque</b>\n` +
            `<b>${featured.name}</b> | <b>R$ ${featured.price}</b>\n` +
            `Toque em <b>${buyLabel}</b> abaixo para ver a descrição e finalizar.\n` +
            `Na ficha do produto você escolhe <b>Comprar</b> ou <b>Adicionar ao carrinho</b>.`
        );
    }

    function scheduleNewMemberAlerts(ctx, referredBy, extra = {}) {
        const { scheduleNewMemberNotify } = require('../../services/NewMemberNotifyService');
        const from = ctx?.from || ctx;
        const payload =
            extra.startPayload ??
            (typeof ctx?.message?.text === 'string'
                ? (ctx.message.text.match(/^\/start(?:@\w+)?\s+(.*)$/i)?.[1] || '').trim()
                : '');
        scheduleNewMemberNotify(
            { ...ctx, from },
            {
                CONFIG,
                prisma,
                dbRaw,
                bot,
                getVipGroupId,
                stateManager,
                deferBackground,
            },
            { referredBy, startPayload: payload }
        );
    }

    async function replyWithMenuPhoto(ctx, text, keyboard = null, extra = {}) {
        return Msg.replaceMenu(ctx, text, keyboard, { useMenuPhoto: true, ...extra });
    }

    async function sendProductWithPhoto(ctx, p) {
        if (isGroupChat(ctx)) {
            return groupGuard.sendGroupProductPreview(ctx, bot, p);
        }
        const key = cartKey(ctx);
        const items = (await Cart.get(key)) || [];
        const cartQty = items.filter((i) => Number(i.id) === Number(p.id)).reduce((s, i) => s + (i.qty || 1), 0);
        const cartTotal = await Cart.total(key);
        const hasStock = (p.stock ?? 999) > 0;
        let restockSubscribed = false;
        if (!hasStock && ctx.from?.id) {
            const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
            if (user) {
                restockSubscribed = await prisma.restockNotify.isRegistered(user.id, p.id);
            }
        }
        const { buildBuyerProductText } = require('../../utils/productListing');
        const text = buildBuyerProductText(p, { showStock: true });
        const kb = Menu.produto(p.id, hasStock, cartQty, cartTotal, restockSubscribed);
        const opts = {};
        const { isUsablePhotoUrl } = require('../../telegram/Msg');
        if (p.photo_url && isUsablePhotoUrl(String(p.photo_url))) {
            opts.photoUrl = p.photo_url;
        } else if (p.photo) {
            const { resolveLocalFile } = require('../../utils/safeLocalPath');
            const fp = resolveLocalFile(CONFIG.CAMINHO_FOTOS, p.photo);
            if (fp) opts.photoUrl = { source: fp };
        }
        const photoOpts = {
            photoUrl: opts.photoUrl,
            useMenuPhoto: !opts.photoUrl,
        };
        if (ctx.callbackQuery) {
            return Msg.edit(ctx, text, kb, photoOpts);
        }
        return Msg.replaceMenu(ctx, text, kb, photoOpts);
    }

    async function replyMainMenuFallback(ctx, text, replyMarkup) {
        const { getMenuPhotoInput } = require('../../telegram/menuPhoto');
        const { truncateTelegramHtml, isCaptionTooLongError } = require('../../telegram/telegramLimits');
        const photo = getMenuPhotoInput(ctx.from?.id);
        const safeCaption = truncateTelegramHtml(text);
        try {
            if (photo) {
                try {
                    await ctx.replyWithPhoto(photo, {
                        caption: safeCaption,
                        parse_mode: 'HTML',
                        reply_markup: replyMarkup,
                    });
                } catch (e) {
                    if (isCaptionTooLongError(e)) {
                        await Msg.reply(ctx, text, replyMarkup ? Markup.inlineKeyboard(replyMarkup.inline_keyboard || replyMarkup) : null);
                    } else {
                        throw e;
                    }
                }
            } else {
                await Msg.reply(ctx, text, replyMarkup ? Markup.inlineKeyboard(replyMarkup.inline_keyboard || replyMarkup) : null);
            }
        } catch (e2) {
            logger.error(`Erro sendMainMenu fallback: ${e2.message}`);
            try {
                await Msg.reply(ctx, text, replyMarkup ? Markup.inlineKeyboard(replyMarkup.inline_keyboard || replyMarkup) : null);
            } catch { /* ignore */ }
        }
    }

    async function sendMainMenu(ctx, forceUser = false, sessionCleared = null) {
        try {
            if (isGroupChat(ctx) && !forceUser) {
                return groupGuard.sendGroupWelcome(ctx, bot, { supportUrl: CONFIG.CONTATO_ESPECIALISTA });
            }

            const uid = ctx.from?.id;
            const isAdminUserEarly = !forceUser && isAdmin(uid);
            if (!isAdminUserEarly && uid) {
                const refGuard = require('../referenceChannelGuard');
                if (!(await refGuard.enforce(ctx))) return;
            }

            const nome = ctx.from?.first_name ? ` ${ctx.from.first_name}` : '';
            const h = new Date().getUTCHours() - 3;
            const saudacao = h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
            const chatId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;

            if (!chatId) {
                logger.error('sendMainMenu: chatId is null');
                return;
            }

            if (uid && !isAdmin(uid)) {
                try {
                    const { trackFromTelegramId } = require('../../services/ConversionEventService');
                    trackFromTelegramId(uid, 'menu_opened', { source: 'main_menu' });
                } catch (_) { /* telemetry */ }
            }

            const isAdminUser = !forceUser && isAdmin(uid);
            const isStartCmd = Boolean(
                ctx.message?.text && /^\/start\b/i.test(String(ctx.message.text).trim())
            );

            let isSubscriber = false;
            let productCount = 0;

            if (isAdminUser) {
                const menu = Menu.admin();
                if (!menu || !menu.reply_markup) {
                    logger.error('sendMainMenu: menu or reply_markup is null');
                    return;
                }
                const mm = getMaintenanceMode();
                const buildAdminCaption = (summary) =>
                    sessionNote(
                        `${ADMIN_HTML.header('Hanork Bot — Admin')}\n` +
                            `<i>Gerencie loja, pedidos, clientes e relatórios.</i>\n\n` +
                            `${ADMIN_HTML.sub(`${saudacao}${nome}!`)}\n\n` +
                            (summary && summary.income != null
                                ? `Hoje: ${ADMIN_HTML.green(`R$ ${summary.income.toFixed(2)} recebidos`)} | ` +
                                  `${ADMIN_HTML.red(`R$ ${summary.expense.toFixed(2)} gastos`)}\n\n`
                                : `Hoje: <i>carregando resumo financeiro…</i>\n\n`) +
                            `${mm ? ADMIN_HTML.red('MANUTENÇÃO ATIVA') : ADMIN_HTML.green('LOJA OPERACIONAL')}`,
                        sessionCleared
                    );

                if (isStartCmd && !ctx.callbackQuery) {
                    await sendAdminPanelWithPhoto(ctx, buildAdminCaption(null), menu);
                    deferBackground('admin-cashflow-start', async () => {
                        const { getCashFlowToday } = require('../../utils/financeSummaryCache');
                        let summary = { income: 0, expense: 0 };
                        try {
                            summary = await getCashFlowToday(prisma);
                        } catch { /* ignore */ }
                        const { truncateTelegramHtml } = require('../../telegram/telegramLimits');
                        const fullCaption = truncateTelegramHtml(buildAdminCaption(summary));
                        await Msg.edit(ctx, fullCaption, menu, { useMenuPhoto: true }).catch(() => {});
                    });
                    return;
                }

                const { getCashFlowToday } = require('../../utils/financeSummaryCache');
                let summary = { income: 0, expense: 0 };
                try {
                    summary = await getCashFlowToday(prisma);
                } catch { /* ignore */ }
                const adminCaption = buildAdminCaption(summary);
                return sendAdminPanelWithPhoto(ctx, adminCaption, menu);
            }

            let products = [];
            if (isStartCmd) {
                try {
                    const row = dbRaw().prepare('SELECT COUNT(*) AS c FROM products WHERE active = 1').get();
                    productCount = Number(row?.c) || 0;
                } catch {
                    try {
                        products = await loadProducts();
                        productCount = products?.length || 0;
                    } catch { /* ignore */ }
                }
            } else {
                try {
                    products = await loadProducts();
                } catch { /* ignore */ }
                productCount = products?.length || 0;
            }

            let user = null;
            try {
                user = prisma.user.findUnique({ where: { telegram_id: uid.toString() } });
            } catch { /* ignore */ }
            if (user) {
                const CustomerSubscriptionService = require('../../modules/subscription/CustomerSubscriptionService');
                isSubscriber = CustomerSubscriptionService.isActive(user.id);
            }
            const featured = await resolveFeaturedProduct(products);

            const refGuard = require('../referenceChannelGuard');
            let showRefChannel = true;
            let channelNotice = '';
            if (!isAdminUser && refGuard.isEnabled()) {
                const joined = await refGuard.isMember(ctx);
                showRefChannel = !joined;
                channelNotice = refGuard.buildMenuChannelNotice(joined);
            }

            const menu = Menu.principal(isSubscriber, productCount, featured, uid, forceUser ? () => false : isAdmin, {
                showRefChannel,
                isStartScreen: isStartCmd && !ctx.callbackQuery,
            });

            if (!menu || !menu.reply_markup) {
                logger.error('sendMainMenu: menu or reply_markup is null');
                return;
            }

            const {
                buildStaticMenuAssistantBlock,
                isStartIntroAiEnabled,
            } = require('./menuCopy');
            const startFeaturedOn =
                String(process.env.HANORK_START_FEATURED ?? '0').trim().toLowerCase() === '1' ||
                String(process.env.HANORK_START_FEATURED ?? '0').trim().toLowerCase() === 'true';
            const productNames = (products || []).map((p) => p?.name).filter(Boolean);
            let staticIntro = '';
            if (
                !isStartCmd &&
                !ctx.callbackQuery &&
                !isStartIntroAiEnabled()
            ) {
                const extra = buildStaticMenuAssistantBlock({ productNames, productCount });
                if (extra) staticIntro = `\n\n${extra}`;
            }

            const bemVindo = sessionNote(
                `<b>${saudacao}${nome}!</b>\n` +
                    `<i>Compre produtos, acompanhe pedidos e acesse sua conta.</i>\n\n` +
                    TEXTO.boasVindas +
                    channelNotice +
                    (isStartCmd && startFeaturedOn ? await buildFeaturedProductLine(products) : '') +
                    staticIntro,
                sessionCleared
            );
            const replyMarkup = menu.reply_markup || menu;
            try {
                const { shouldForceNewMessage } = require('../../telegram/freshUi');
                const r = await Msg.replaceMenu(ctx, bemVindo, menu, {
                    useMenuPhoto: true,
                    forceNew: shouldForceNewMessage(ctx),
                });
                if (!r || r.action === 'blocked' || !r.messageId) {
                    await replyMainMenuFallback(ctx, bemVindo, replyMarkup);
                } else if (
                    isStartCmd &&
                    !ctx.callbackQuery &&
                    isStartIntroAiEnabled()
                ) {
                    const staticCaption = bemVindo;
                    deferBackground('start-intro-ai', async () => {
                        try {
                            const ZeroTwoAi = require('../../services/ZeroTwoAiService');
                            const {
                                buildStaticMenuAssistantBlock,
                            } = require('./menuCopy');
                            if (!ZeroTwoAi.isConfigured() || ZeroTwoAi.isRateLimited()) {
                                const fallback = buildStaticMenuAssistantBlock({
                                    productNames,
                                    productCount,
                                });
                                await Msg.edit(ctx, `${staticCaption}\n\n${fallback}`, menu, {
                                    useMenuPhoto: true,
                                }).catch(() => {});
                                return;
                            }
                            const intro = await ZeroTwoAi.askHanorkIntro({
                                firstName: ctx.from?.first_name,
                                productCount,
                                productNames,
                                botName: process.env.BOT_DISPLAY_NAME || 'Hanork',
                                shopTagline: process.env.BOT_SHOP_TAGLINE || 'loja digital no Telegram',
                            });
                            const block =
                                intro ||
                                buildStaticMenuAssistantBlock({ productNames, productCount });
                            await Msg.edit(ctx, `${staticCaption}\n\n${block}`, menu, {
                                useMenuPhoto: true,
                            }).catch(() => {});
                        } catch (e) {
                            logger.debug('[start] intro IA defer:', e.message);
                        }
                    });
                }
            } catch (err) {
                logger.error(`Erro sendMainMenu: ${err.message}`);
                await replyMainMenuFallback(ctx, bemVindo, replyMarkup);
            }
        } catch (e) {
            logger.error(`Erro geral no sendMainMenu: ${e.message}`);
        }
    }

    return {
        sendMainMenu,
        replyWithMenuPhoto,
        sendProductWithPhoto,
        scheduleNewMemberAlerts,
        resolveFeaturedProduct,
        buildFeaturedProductLine,
    };
}

module.exports = { createMainMenuHandlers };
