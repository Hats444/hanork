'use strict';

const catalogUi = require('../../catalogUi');

function createCatalogHandlers(deps) {
    const {
        loadProducts,
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
    } = deps;

    const getProductById = deps.getProductById;
    const sendProductWithPhoto = deps.sendProductWithPhoto;
    const antiSpam = deps.antiSpam;
    const Menu = deps.Menu;

    async function openUserCatalog(ctx, view = { mode: 'hub' }) {
        const refGuard = require('../../referenceChannelGuard');
        const { CHANNEL_UI } = require('../../../config/salesReferenceChannel');
        if (refGuard.isEnabled()) {
            if (isGroupChat(ctx)) {
                if (!(await refGuard.isMember(ctx))) {
                    const pending = { type: 'callback', data: 'catalog:view' };
                    refGuard.savePendingAction(ctx.from?.id, pending);
                    await groupGuard.replyGroupRedirect(ctx, bot || ctx.bot, {
                        startPayload: refGuard.mapPendingToStartPayload(pending) || 'comprar',
                        title: `📢 ${CHANNEL_UI.title}`,
                        buttonText: '📢 Canal + abrir catálogo no privado',
                        body:
                            'Inscreva-se no <b>canal de referências</b> para usar a loja.\n\n' +
                            'Toque no botão → entre no canal → abra o catálogo no privado.',
                        showAlert: true,
                    });
                    return;
                }
            } else if (!(await refGuard.enforce(ctx))) {
                return;
            }
        }

        try {
            const { trackFromTelegramId } = require('../../../services/ConversionEventService');
            trackFromTelegramId(ctx.from?.id, 'catalog_opened', { mode: view?.mode || 'hub' });
        } catch (_) { /* telemetry */ }
        const prods = await loadProducts();
        if (!prods.length && view.mode !== 'search_prompt') {
            const empty = '🛍️ Nenhum produto disponível no momento.';
            if (ctx.callbackQuery) {
                try {
                    return await Msg.edit(ctx, empty, Menu.navCatalogMenu());
                } catch {
                    return Msg.reply(ctx, empty, Menu.navCatalogMenu());
                }
            }
            return replyWithMenuPhoto(ctx, empty, Menu.navCatalogMenu());
        }
        if (isGroupChat(ctx)) {
            return groupGuard.sendGroupCatalogView(ctx, prods, view);
        }
        return catalogUi.sendCatalogView(ctx, prods, view, { replyWithMenuPhoto });
    }

    async function showCatalog(ctx) {
        await openUserCatalog(ctx, { mode: 'hub' });
    }

    async function showCart(ctx) {
        if (!(await deps.requirePrivate(ctx))) return;
        const refGuard = require('../../referenceChannelGuard');
        if (!(await refGuard.enforce(ctx))) return;
        const key = cartKey(ctx);
        if (!key) {
            return Msg.reply(
                ctx,
                '❌ Não foi possível identificar sua conta. Use /start no privado.',
                Menu.navCatalogMenu()
            );
        }
        const s = await Cart.summary(key);
        if (!s) return replyWithMenuPhoto(ctx, TEXTO.carrinho.vazio, Menu.carrinho({ empty: true }));
        const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
        const baseTotal = await Cart.total(key);
        const t = await Cart.totalWithDiscount(key, user?.id);
        let text = TEXTO.carrinho.itens.replace('{itens}', s).replace('{total}', t.toFixed(2));
        if (t < baseTotal - 0.001) {
            text += `\n\n💎 <i>Desconto assinante: de R$ ${baseTotal.toFixed(2)} → R$ ${t.toFixed(2)}</i>`;
        }
        await replyWithMenuPhoto(ctx, text, Menu.carrinho({ empty: false }));
    }

    function registerCatalogRoutes(bot) {
        bot.command('catalogo', async (ctx) => openUserCatalog(ctx, { mode: 'hub' }));
        bot.command('cat', async (ctx) => openUserCatalog(ctx, { mode: 'hub' }));

        bot.action('cat_hub', async (ctx) => {
            if (!(await checkCallbackWithResponse(ctx, 'cat_nav'))) return;
            await openUserCatalog(ctx, { mode: 'hub' });
        });

        bot.action('cat_search', async (ctx) => {
            if (!(await checkCallbackWithResponse(ctx, 'cat_nav'))) return;
            const cleared = await botSession.enterUserFlow(ctx, 'catalogSearch');
            catalogSearchMode.set(ctx.from.id, { _ts: Date.now() });
            await Msg.reply(
                ctx,
                sessionNote(
                    '🔍 <b>Buscar no catálogo</b>\n\nDigite o nome ou parte da descrição do produto.\n\n<i>/cancelar para sair</i>',
                    cleared
                ),
                Markup.inlineKeyboard([[{ text: '📂 Voltar ao catálogo', callback_data: 'cat_hub' }]])
            );
        });

        bot.action(/^cat_list_(\d+)_([a-z]+)$/, async (ctx) => {
            if (!(await checkCallbackWithResponse(ctx, 'cat_nav'))) return;
            await openUserCatalog(ctx, {
                mode: 'list',
                page: parseInt(ctx.match[1], 10) || 0,
                sort: ctx.match[2],
            });
        });

        bot.action(/^cat_list_(\d+)$/, async (ctx) => {
            if (!(await checkCallbackWithResponse(ctx, 'cat_nav'))) return;
            await openUserCatalog(ctx, { mode: 'list', page: parseInt(ctx.match[1], 10) || 0 });
        });

        bot.action(/^cat_f_([a-z0-9]+)_(\d+)$/, async (ctx) => {
            if (!(await checkCallbackWithResponse(ctx, 'cat_nav'))) return;
            await openUserCatalog(ctx, {
                mode: 'format',
                formatKey: ctx.match[1],
                page: parseInt(ctx.match[2], 10) || 0,
            });
        });

        bot.action(/^cat_pg_(\d+)$/, async (ctx) => {
            if (!(await checkCallbackWithResponse(ctx, 'cat_nav'))) return;
            await openUserCatalog(ctx, { mode: 'list', page: parseInt(ctx.match[1], 10) || 0 });
        });

        /** Legado catálogo — callback p_{id} (M3) */
        bot.action(/^p_(\d+)$/, async (ctx) => {
            const pid = parseInt(ctx.match[1], 10);
            await ctx.answerCbQuery();
            if (antiSpam && !antiSpam.checkCallback(ctx.chat.id, `p_${pid}`)) return;
            const getProduct = getProductById;
            const showProduct = sendProductWithPhoto;
            if (!getProduct || !showProduct) return;
            const p = await getProduct(pid);
            if (!p) {
                return Msg.edit(
                    ctx,
                    '❌ Produto não encontrado.',
                    Markup.inlineKeyboard([[{ text: '🏠 Menu', callback_data: 'home' }]])
                );
            }
            try {
                const { trackFromTelegramId } = require('../../../services/ConversionEventService');
                trackFromTelegramId(ctx.from?.id, 'product_viewed', { product_id: pid, name: p.name });
            } catch (_) { /* telemetry */ }
            await showProduct(ctx, p);
        });
    }

    return { openUserCatalog, showCatalog, showCart, registerCatalogRoutes };
}

module.exports = { createCatalogHandlers };
