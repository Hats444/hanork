'use strict';

const { Markup } = require('telegraf');
const { ACTIONS } = require('../../config/hanork-ai-actions');
const COPY = require('../../config/hanork-router-copy');
const aiSupport = require('../../config/ai-support');
const NL = require('./HanorkNlExtractors');
const ProductSearchService = require('../ProductSearchService');

function standardKeyboard() {
    return Markup.inlineKeyboard([
        [{ text: '📂 Catálogo', callback_data: 'cat' }],
        [{ text: '🏠 Menu', callback_data: 'menu:home' }],
    ]);
}

function pickProducts(question, products, limit = 1) {
    return ProductSearchService.pickProducts(products, question, limit);
}

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function adminPanel(ctx, Msg, isAdmin, native, callbackData, caption) {
    if (!isAdmin(ctx.from?.id)) {
        await Msg.reply(ctx, COPY.adminOnly, null, { parse_mode: 'HTML' });
        return { ok: true };
    }
    if (typeof native.openAdminCallback === 'function') {
        await native.openAdminCallback(ctx, callbackData, caption);
        return { ok: true };
    }
    return replyHint(Msg, ctx, '/admin');
}

async function replyHint(Msg, ctx, commandHint) {
    await Msg.reply(
        ctx,
        `Utilize <code>${commandHint}</code> ou o menu abaixo.`,
        standardKeyboard(),
        { parse_mode: 'HTML' }
    );
    return { ok: true };
}

/**
 * Executa fluxo nativo do Hanork (sem conversa contínua / sem inventar dados).
 */
async function execute(ctx, intent, deps) {
    const {
        Msg,
        logger,
        loadProducts,
        sendProductWithPhoto,
        openUserCatalog,
        showCart,
        startSupportFlow,
        native = {},
        isAdmin,
    } = deps;

    const { action, params = {} } = intent;

    logger.info('[HanorkRouter] execute', {
        action,
        uid: ctx.from?.id,
        confidence: intent.confidence,
    });

    switch (action) {
        case ACTIONS.PLAY_MUSIC:
            if (typeof native.runPlayQuery === 'function') {
                const sourceText = intent.sourceText || params.query || '';
                await native.runPlayQuery(ctx, params.query || '', {
                    sendIntent: !!params.sendIntent || NL.isSendMusicIntent(sourceText),
                    sourceText,
                });
                return { ok: true };
            }
            return replyHint(Msg, ctx, '/play nome ou link do YouTube');

        case ACTIONS.DOWNLOAD: {
            const url = params.url;
            const sourceText = intent.sourceText || url || '';
            if (url) {
                const kind = params.urlKind || 'generic';
                const opts = {
                    sendIntent:
                        !!params.sendIntent ||
                        NL.isSendDownloadIntent(sourceText) ||
                        NL.hasSendVerb(sourceText),
                    sourceText,
                };
                if (kind === 'youtube' && native.runYoutubeQuery) {
                    await native.runYoutubeQuery(ctx, url, opts);
                    return { ok: true };
                }
                if (kind === 'youtube' && native.runPlayQuery) {
                    await native.runPlayQuery(ctx, url, opts);
                    return { ok: true };
                }
                if (kind === 'tiktok' && native.runTikTokQuery) {
                    await native.runTikTokQuery(ctx, url, opts);
                    return { ok: true };
                }
                if (kind === 'instagram' && native.runInstagramQuery) {
                    await native.runInstagramQuery(ctx, url, opts);
                    return { ok: true };
                }
            }
            if (params.tiktokQuery && native.runTikTokQuery) {
                const sourceText = intent.sourceText || params.tiktokQuery;
                await native.runTikTokQuery(ctx, params.tiktokQuery, {
                    sendIntent:
                        !!params.sendIntent ||
                        NL.isSendTiktokIntent(sourceText) ||
                        NL.isSendVideoIntent(sourceText),
                    sourceText,
                });
                return { ok: true };
            }
            if (params.instagramParsed && native.runInstagramQuery) {
                const sourceText = intent.sourceText || '';
                await native.runInstagramQuery(ctx, NL.formatInstagramRouterInput(params.instagramParsed), {
                    sendIntent: !!params.sendIntent || NL.isSendInstagramIntent(sourceText),
                    instagramParsed: params.instagramParsed,
                    sourceText,
                });
                return { ok: true };
            }
            if (typeof native.openDownloadsHub === 'function') {
                await native.openDownloadsHub(ctx);
                return { ok: true };
            }
            return replyHint(Msg, ctx, '/downloads');
        }

        case ACTIONS.SHOW_PRODUCTS:
            if (openUserCatalog) await openUserCatalog(ctx, { mode: 'hub' });
            return { ok: true };

        case ACTIONS.RECOMMEND_PRODUCT: {
            const products = await loadProducts().catch(() => []);
            const picked = pickProducts(intent.sourceText || '', products, 1);
            if (!picked.length) {
                await Msg.reply(ctx, COPY.catalogEmpty, standardKeyboard(), { parse_mode: 'HTML' });
                return { ok: true };
            }
            const p = picked[0];
            await Msg.reply(ctx, COPY.recommendLead(escapeHtml(p.name)), null, { parse_mode: 'HTML' });
            if (sendProductWithPhoto) await sendProductWithPhoto(ctx, p);
            return { ok: true };
        }

        case ACTIONS.PRODUCT_SEARCH: {
            const query = params.query || '';
            if (!query) return { ok: false, needsClarify: true };
            const products = await loadProducts().catch(() => []);
            const { results } = ProductSearchService.searchProducts(products, query);
            if (!results.length) {
                await Msg.reply(
                    ctx,
                    `🔍 Nenhum produto para <code>${escapeHtml(query)}</code>.\n\n` +
                        '<i>Tente outro nome, parte da descrição ou categoria.</i>',
                    standardKeyboard(),
                    { parse_mode: 'HTML' }
                );
                return { ok: true };
            }
            if (openUserCatalog) await openUserCatalog(ctx, { mode: 'list', page: 0, query });
            return { ok: true };
        }

        case ACTIONS.CART:
            if (showCart) {
                await showCart(ctx);
                return { ok: true };
            }
            return replyHint(Msg, ctx, '/checkout ou botão Carrinho no menu');

        case ACTIONS.CHECKOUT:
            if (typeof native.processCheckout === 'function') {
                await native.processCheckout(ctx);
                return { ok: true };
            }
            return replyHint(Msg, ctx, '/checkout');

        case ACTIONS.PIX: {
            const pixResult = await aiSupport.processMessage('pix', {});
            await Msg.reply(
                ctx,
                pixResult?.response ||
                    '<b>Pagamento PIX</b>\n\nConfirmado via Mercado Pago. A entrega é automática após a confirmação.\n\nAdicione itens ao carrinho e use <code>/checkout</code>.',
                standardKeyboard(),
                { parse_mode: 'HTML' }
            );
            return { ok: true };
        }

        case ACTIONS.COUPON:
            if (typeof native.dispatchSlash === 'function') {
                await native.dispatchSlash(ctx, 'cupom', '');
                return { ok: true };
            }
            return replyHint(Msg, ctx, '/cupom (no privado, antes do checkout)');

        case ACTIONS.AFFILIATE:
            if (typeof native.openAffiliate === 'function') {
                await native.openAffiliate(ctx);
                return { ok: true };
            }
            return replyHint(Msg, ctx, '/afiliado');

        case ACTIONS.SUBSCRIPTION:
            if (typeof native.openSubscription === 'function') {
                await native.openSubscription(ctx);
                return { ok: true };
            }
            return replyHint(Msg, ctx, '/assinatura');

        case ACTIONS.FLASH_SALES:
            if (typeof native.openFlashSales === 'function') {
                await native.openFlashSales(ctx);
                return { ok: true };
            }
            return replyHint(Msg, ctx, '/flashsales');

        case ACTIONS.GIVEAWAY:
            if (typeof native.openGiveaway === 'function') {
                await native.openGiveaway(ctx);
                return { ok: true };
            }
            await Msg.reply(ctx, COPY.giveawayIdle, standardKeyboard(), { parse_mode: 'HTML' });
            return { ok: true };

        case ACTIONS.SUPPORT:
            if (typeof startSupportFlow === 'function') {
                await startSupportFlow(ctx);
                return { ok: true };
            }
            return replyHint(Msg, ctx, 'hanork:ticket no menu ou /suporte');

        case ACTIONS.WHATSAPP:
            if (!isAdmin(ctx.from?.id)) return { ok: false, silent: true };
            if (typeof native.openWhatsAppPanel === 'function') {
                await native.openWhatsAppPanel(ctx);
                return { ok: true };
            }
            return replyHint(Msg, ctx, 'painel Admin → WhatsApp');

        case ACTIONS.BROADCAST_GROUPS_PREPARE:
            if (!isAdmin(ctx.from?.id)) {
                await Msg.reply(ctx, COPY.adminOnly, null, { parse_mode: 'HTML' });
                return { ok: true };
            }
            if (native.enterBroadcastGroupsMode) await native.enterBroadcastGroupsMode(ctx);
            return { ok: true };

        case ACTIONS.BROADCAST_GROUPS_RUN:
            if (!isAdmin(ctx.from?.id)) {
                await Msg.reply(ctx, COPY.adminOnly, null, { parse_mode: 'HTML' });
                return { ok: true };
            }
            if (native.runGroupBroadcastNow) {
                await native.runGroupBroadcastNow(ctx, {
                    mode: params.mode || (params.body ? 'custom' : 'catalog'),
                    body: params.body,
                });
            }
            return { ok: true };

        case ACTIONS.BROADCAST_CHANNELS_RUN:
            if (!isAdmin(ctx.from?.id)) {
                await Msg.reply(ctx, COPY.adminOnly, null, { parse_mode: 'HTML' });
                return { ok: true };
            }
            if (native.runChannelBroadcastNow) {
                await native.runChannelBroadcastNow(ctx, {
                    mode: params.mode || (params.body ? 'custom' : 'catalog'),
                    body: params.body,
                });
            }
            return { ok: true };

        case ACTIONS.BROADCAST_FULL_RUN:
            if (!isAdmin(ctx.from?.id)) {
                await Msg.reply(ctx, COPY.adminOnly, null, { parse_mode: 'HTML' });
                return { ok: true };
            }
            if (native.runBroadcastFullNow) {
                await native.runBroadcastFullNow(ctx, {
                    mode: params.mode || (params.body ? 'custom' : 'catalog'),
                    body: params.body,
                });
            }
            return { ok: true };

        case ACTIONS.BROADCAST_IA_PREPARE:
            if (!isAdmin(ctx.from?.id)) {
                await Msg.reply(ctx, COPY.adminOnly, null, { parse_mode: 'HTML' });
                return { ok: true };
            }
            if (native.enterBroadcastIaMode) await native.enterBroadcastIaMode(ctx);
            return { ok: true };

        case ACTIONS.BROADCAST_TEXT_PREPARE:
            if (!isAdmin(ctx.from?.id)) {
                await Msg.reply(ctx, COPY.adminOnly, null, { parse_mode: 'HTML' });
                return { ok: true };
            }
            if (native.enterBroadcastTextMode) await native.enterBroadcastTextMode(ctx);
            return { ok: true };

        case ACTIONS.BROADCAST_PRODUCT_PICK:
            if (!isAdmin(ctx.from?.id)) {
                await Msg.reply(ctx, COPY.adminOnly, null, { parse_mode: 'HTML' });
                return { ok: true };
            }
            if (native.openBroadcastProductPicker) await native.openBroadcastProductPicker(ctx);
            return { ok: true };

        case ACTIONS.BROADCAST:
            if (!isAdmin(ctx.from?.id)) return { ok: false, silent: true };
            if (typeof native.openBroadcastPanel === 'function') {
                await native.openBroadcastPanel(ctx);
                return { ok: true };
            }
            await Msg.reply(ctx, COPY.adminBroadcastHint, null, { parse_mode: 'HTML' });
            return { ok: true };

        case ACTIONS.ADMIN_STATS:
            return adminPanel(ctx, Msg, isAdmin, native, 'a_stats', '<b>Estatísticas</b> — visão geral da loja.');

        case ACTIONS.ADMIN_ORDERS:
            return adminPanel(ctx, Msg, isAdmin, native, 'a_orders', '<b>Pedidos</b> — pendentes e entregas.');

        case ACTIONS.PRODUCT_EDIT_FIELD:
            if (typeof native.applyProductFieldUpdate === 'function') {
                return native.applyProductFieldUpdate(ctx, params);
            }
            return replyHint(Msg, ctx, '/editproduto ID nome Valor');

        case ACTIONS.PRODUCT_EDIT_PRICE:
            if (typeof native.applyProductPriceUpdate === 'function') {
                await native.applyProductPriceUpdate(ctx, params);
                return { ok: true };
            }
            if (params.productId && params.price != null && native.dispatchSlash) {
                await native.dispatchSlash(
                    ctx,
                    'editproduto',
                    `${params.productId} preco ${params.price}`
                );
                return { ok: true };
            }
            return replyHint(Msg, ctx, '/editproduto ID preco 29.90');

        case ACTIONS.PRODUCT_PAUSE:
            if (typeof native.applyProductPause === 'function') {
                return native.applyProductPause(ctx, params);
            }
            return replyHint(Msg, ctx, '/removeproduto ID');

        case ACTIONS.PRODUCT_REACTIVATE:
            if (typeof native.applyProductReactivate === 'function') {
                return native.applyProductReactivate(ctx, params);
            }
            return replyHint(Msg, ctx, '/reativarproduto ID');

        case ACTIONS.ADMIN_PRODUCTS:
            return adminPanel(ctx, Msg, isAdmin, native, 'prod_menu_back', '<b>Produtos</b> — gerenciar catálogo.');

        case ACTIONS.ADMIN_GROUPS:
            return adminPanel(ctx, Msg, isAdmin, native, 'a_grupos', '<b>Grupos</b> — lista e configuração.');

        case ACTIONS.ADMIN_CHANNELS:
            return adminPanel(ctx, Msg, isAdmin, native, 'a_canais', '<b>Canais</b> — lista e permissões.');

        case ACTIONS.ADMIN_TICKETS:
            return adminPanel(ctx, Msg, isAdmin, native, 'a_tickets', '<b>Tickets</b> — suporte aberto.');

        case ACTIONS.ADMIN_FINANCE:
            return adminPanel(ctx, Msg, isAdmin, native, 'a_finance', '<b>Financeiro</b> — entradas e saídas.');

        case ACTIONS.ADMIN_REPORT:
            return replyHint(Msg, ctx, '/relatorio');

        case ACTIONS.ADMIN_USERS:
            return adminPanel(ctx, Msg, isAdmin, native, 'a_users', '<b>Usuários</b> — clientes cadastrados.');

        case ACTIONS.HELP: {
            const shortHelp =
                String(intent.sourceText || '').trim().length < 42 &&
                /\b(me\s+)?ajuda\b/i.test(intent.sourceText || '');
            if (shortHelp) {
                await Msg.reply(ctx, COPY.hintInvoke, standardKeyboard(), { parse_mode: 'HTML' });
                return { ok: true };
            }
            if (typeof native.runHelp === 'function') await native.runHelp(ctx);
            else return replyHint(Msg, ctx, '/help');
            return { ok: true };
        }

        case ACTIONS.ACCOUNT:
            if (typeof native.runAccount === 'function') await native.runAccount(ctx);
            else return replyHint(Msg, ctx, '/meusdados');
            return { ok: true };

        case ACTIONS.TRACK_ORDER:
            if (typeof native.dispatchSlash === 'function') {
                await native.dispatchSlash(ctx, 'rastrear', params.orderId || '');
                return { ok: true };
            }
            return replyHint(Msg, ctx, '/rastrear');

        case ACTIONS.FAVORITES:
            if (typeof native.runFavorites === 'function') await native.runFavorites(ctx);
            else return replyHint(Msg, ctx, '/favoritos');
            return { ok: true };

        case ACTIONS.ADMIN:
            if (!isAdmin(ctx.from?.id)) return { ok: false, silent: true };
            if (params._dashboardUrl || params._dashboardMobile) {
                if (params._dashboardUrl) {
                    await Msg.reply(
                        ctx,
                        `📱 <b>Dashboard Hanork</b>\n\nAbra no <b>navegador do celular</b> (Safari/Chrome) — não funciona colando aqui no Telegram.\n\n` +
                            `Mesmo Wi‑Fi do PC:\n<code>${params._dashboardUrl}</code>`,
                        null,
                        { parse_mode: 'HTML', disable_web_page_preview: true }
                    );
                } else {
                    const {
                        formatAdminAccessTelegram,
                        refreshLanNetworkCache,
                    } = require('../../utils/dashboardNetwork');
                    refreshLanNetworkCache();
                    await Msg.reply(
                        ctx,
                        `📱 <b>Dashboard no celular</b>\n\nAbra no navegador (mesmo Wi‑Fi do PC):\n\n${formatAdminAccessTelegram()}`,
                        null,
                        { parse_mode: 'HTML', disable_web_page_preview: true }
                    );
                }
                return { ok: true };
            }
            if (typeof native.openAdminPanel === 'function') {
                await native.openAdminPanel(ctx);
                return { ok: true };
            }
            return replyHint(Msg, ctx, '/start (conta admin)');

        case ACTIONS.RUN_SLASH: {
            const slash = params.slash || '';
            const args = params.args || '';
            if (typeof native.dispatchSlash === 'function') {
                const r = await native.dispatchSlash(ctx, slash, args);
                if (!r?.ok) {
                    await Msg.reply(
                        ctx,
                        `Não foi possível executar <code>/${slash}</code>. Tente o comando direto.`,
                        standardKeyboard(),
                        { parse_mode: 'HTML' }
                    );
                }
                return { ok: true };
            }
            return replyHint(Msg, ctx, `/${slash}${args ? ` ${args}` : ''}`);
        }

        case ACTIONS.RUN_CALLBACK: {
            const cb = String(params.callback || '').trim();
            const { isCallbackAdminOnly } = require('./HanorkUniversalRegistry');
            if (isCallbackAdminOnly(cb) && !isAdmin(ctx.from?.id)) {
                await Msg.reply(ctx, COPY.adminOnly, null, { parse_mode: 'HTML' });
                return { ok: true };
            }
            if (typeof native.dispatchCallback === 'function') {
                await native.dispatchCallback(ctx, params.callback, params.label);
                return { ok: true };
            }
            return replyHint(Msg, ctx, '/admin');
        }

        default:
            return { ok: false };
    }
}

module.exports = { execute, pickProducts };
