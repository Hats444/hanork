/**
 * UserHandlers - Implementação completa de TODOS os botões quebrados
 * 
 * Botões corrigidos:
 * - search:open (Buscar)
 * - flash:sales (Ofertas)
 * - menu:minha_conta (Minha Conta)
 * - user:favoritos (Favoritos)
 * - subscription:view/buy (Assinatura)
 * - help:open (Ajuda)
 * - order:list/track/resend (Pedidos)
 * - user:cupom (Cupom)
 * - user:afiliado (Afiliado)
 * - user:indicar (Indicar)
 * - user:avaliacoes (Avaliações)
 * - payment:aff:* (Pagamento com saldo)
 * - payment:check:* (Verificar pagamento)
 * - noop:* (Feedback amigável)
 */

'use strict';

const logger = require('../config/logger');
const { Markup } = require('telegraf');
const Msg = require('../telegram/Msg');
const { prisma } = require('../config/database');
const DeliveryService = require('../modules/delivery/DeliveryService');
const AffiliatePaymentService = require('../services/AffiliatePaymentService');
const { requireBotContext } = require('../telegram/callbacks/BotContext');
const dbRaw = require('../config/database-sqlite').connect;
const groupGuard = require('../telegram/groupGuard');
const UserEmailService = require('../services/UserEmailService');
const AffiliateCore = require('../modules/affiliate/AffiliateCore');
const AffiliatePanels = require('../modules/affiliate/AffiliatePanels');
const UserAccountCore = require('../modules/user/UserAccountCore');
const UserAccountPanels = require('../modules/user/UserAccountPanels');
const CustomerSubscriptionService = require('../modules/subscription/CustomerSubscriptionService');
const { DownloadsHandlers } = require('../telegram/downloads/downloadsHandlers');
const { VirtuoHandlers } = require('../modules/virtuo/callbacks/virtuoHandlers');
const { WaDivulgacaoHandlers } = require('../modules/wa-divulgacao/callbacks/waDivulgacaoHandlers');
const { sendWaDivulgacaoHome, isWaDivulgacaoEnabled } = require('../modules/wa-divulgacao/handlers/waDivulgacaoUiHandlers');
const WaDivulgacaoSubscriptionService = require('../modules/wa-divulgacao/waDivulgacaoSubscriptionService');

const AFF_WITHDRAW_MIN = AffiliatePanels.WITHDRAW_MIN;
const { safeAnswerCbQuery } = require('../utils/safeTelegram');

function affSaldo(aff) {
    return AffiliateCore.affiliateEarnings(aff);
}

function getAdminTelegramIds() {
    return (process.env.ID_DONO || '')
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter(Boolean);
}

async function getBotUsername(ctx) {
    if (process.env.BOT_USERNAME) return process.env.BOT_USERNAME;
    try {
        const me = await ctx.telegram.getMe();
        return me.username || 'bot';
    } catch {
        return 'bot';
    }
}

async function ensureAffiliateForUser(user, telegramId) {
    return AffiliateCore.ensureAffiliate(user.id, telegramId);
}

function getCashbackAvailable(prisma, userId) {
    try {
        const v = prisma.cashback?.getAvailable?.(userId);
        const n = typeof v === 'number' ? v : Number(v?.total ?? v ?? 0);
        return Number.isFinite(n) ? n : 0;
    } catch {
        return 0;
    }
}

/** PV: menu com foto alternada (menu.jpg / menu2.jpg) — mesma lógica do /start */
async function uiRespond(ctx, text, keyboard = null, options = {}) {
    if (ctx.callbackQuery?.message) {
        return Msg.editCallbackPanel(ctx, text, keyboard, options);
    }
    return Msg.replaceMenu(ctx, text, keyboard, { useMenuPhoto: true, ...options });
}

// ============================================================================
// UTILITÁRIOS DE UX
// ============================================================================

class UX {
    /**
     * Mostra tela de erro padrão com código de rastreamento
     */
    static async showError(ctx, error, context = {}) {
        const errorId = Math.random().toString(36).substring(2, 10).toUpperCase();
        
        const errMsg = error?.message || String(error);
        logger.error('[UserHandlers] Error', {
            errorId,
            message: errMsg,
            stack: error?.stack,
            userId: ctx.from?.id,
            callback: ctx.callbackQuery?.data,
            handler: context?.handler,
        });

        const text = `<b>Algo deu errado</b>

Código: <code>#${errorId}</code>

Tente novamente em instantes.
Se persistir, contate suporte com o código acima.`;

        await uiRespond(ctx, text, Markup.inlineKeyboard([
            [{ text: 'Menu principal', callback_data: 'menu:home' }],
            [{ text: 'Suporte', url: process.env.CONTATO_ESPECIALISTA || 'https://t.me/hanorkoff' }],
        ]));
    }

    /**
     * Mostra tela de "Funcionalidade em Desenvolvimento"
     */
    static async showDevMode(ctx, featureName) {
        logger.info('[UserHandlers] Dev mode shown', {
            feature: featureName,
            userId: ctx.from?.id
        });

        const text = `<b>Em breve:</b> <b>${featureName}</b>

Esta funcionalidade está em desenvolvimento.

Será lançada em breve.`;

        await uiRespond(ctx, text, Markup.inlineKeyboard([
            [{ text: 'Voltar', callback_data: 'menu:minha_conta' }],
        ]));
    }

    /**
     * Mostra tela de callback inválido
     */
    static async showInvalidCallback(ctx, data) {
        logger.warn('[UserHandlers] Invalid callback', {
            data,
            userId: ctx.from?.id
        });

        await safeAnswerCbQuery(ctx, 'Ação não disponível');
    }

    /**
     * noop — botões desativados (catálogo, teclado antigo, etc.)
     * Não usar tela de "produto esgotado" — confundia saque de afiliado.
     */
    static async showUnavailable(ctx, hint = 'Opção indisponível no momento.') {
        await safeAnswerCbQuery(ctx, hint, { show_alert: true });
    }

    /**
     * Tela de produto fora de estoque (somente catálogo)
     * @param {number|null} productId — se informado, exibe botão de restock funcional
     */
    static async showOutOfStock(ctx, productId = null) {
        await safeAnswerCbQuery(ctx, 'Produto esgotado');

        const text = `<b>Produto esgotado</b>

No momento não há unidades disponíveis.

Você pode pedir aviso quando voltar ao estoque ou ver outros produtos no catálogo.`;

        const rows = [[{ text: 'Ver catálogo', callback_data: 'cat' }]];
        if (productId) {
            const { restockBtn } = require('../utils/buttonLabels');
            rows.unshift([{ text: restockBtn(false), callback_data: `notify_restock_${productId}` }]);
        }

        await uiRespond(ctx, text, Markup.inlineKeyboard(rows));
    }
}

// ============================================================================
// HANDLERS DE MENU E NAVEGAÇÃO
// ============================================================================

const MenuHandlers = {
    /**
     * menu:home - Menu principal
     */
    'menu:home': async (ctx) => {
        try {
            const { requireBotContext } = require('../telegram/callbacks/BotContext');
            const { safeAnswerCbQuery } = require('../utils/safeTelegram');
            const { sendMainMenu, botSession } = requireBotContext(['sendMainMenu', 'botSession']);
            await safeAnswerCbQuery(ctx);
            const sessionCleared = botSession ? await botSession.clearForUserNav(ctx) : {};
            await sendMainMenu(ctx, false, sessionCleared);
            logger.info('[UserHandlers] Menu home', { userId: ctx.from?.id });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'menu:home' });
        }
    },

    'ref:verify': async (ctx) => {
        try {
            const { requireBotContext } = require('../telegram/callbacks/BotContext');
            const { sendMainMenu } = requireBotContext(['sendMainMenu']);
            const refGuard = require('../telegram/referenceChannelGuard');

            if (!refGuard.isRefChannelManualVerifyEnabled()) {
                await safeAnswerCbQuery(
                    ctx,
                    'Entre no canal — a liberação é automática ao entrar.'
                );
                await refGuard.showGatePanel(ctx);
                return;
            }

            const result = await refGuard.completeVerification(ctx, { source: 'manual' });
            if (!result.ok) {
                await safeAnswerCbQuery(
                    ctx,
                    'Ainda não detectamos sua entrada. Entre no canal e tente de novo.'
                );
                await refGuard.showGatePanel(ctx);
                return;
            }
            await safeAnswerCbQuery(ctx, 'Canal confirmado!');
            if (!result.resumed) {
                await sendMainMenu(ctx);
            }
            logger.info('[UserHandlers] Canal referências verificado', {
                userId: ctx.from?.id,
                resumed: result.resumed,
                source: result.source,
            });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'ref:verify' });
        }
    },

    /**
     * menu:minha_conta - Painel da conta
     */
    'menu:minha_conta': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);

            const userId = ctx.from?.id;
            if (!userId) {
                throw new Error('User ID not found in context');
            }

            if (groupGuard.isGroupChat(ctx)) {
                await groupGuard.replyGroupRedirect(ctx, ctx.telegram, {
                    body: 'Sua conta, pedidos e saldo só estão disponíveis em conversa privada com o bot.',
                });
                return;
            }

            const summary = await UserAccountCore.getAccountSummary(userId);
            if (!summary) {
                await uiRespond(
                    ctx,
                    'Inicie o bot com /start',
                    Markup.inlineKeyboard([[{ text: 'Menu principal', callback_data: 'menu:home' }]])
                );
                return;
            }

            const text = UserAccountPanels.buildAccountPanelText(summary, ctx.from);
            const kb = UserAccountPanels.accountPanelKeyboard(summary);

            await uiRespond(ctx, text, kb);

            logger.info('[UserHandlers] Account panel shown', { userId });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'menu:minha_conta' });
        }
    }
};

// ============================================================================
// HANDLERS DE BUSCA
// ============================================================================

const SearchHandlers = {
    /**
     * search:open - Abre interface de busca
     */
    'search:open': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);
            const text =
                `<b>Buscar no catálogo</b>\n\n` +
                `Digite palavras-chave do produto — nome, categoria, formato ou parte da descrição.\n\n` +
                `<i>Atalho:</i> menu <b>Catálogo de produtos</b> → <b>Buscar produto</b>`;
            await uiRespond(ctx, text, Markup.inlineKeyboard([
                [{ text: 'Abrir catálogo', callback_data: 'cat_search' }],
                [{ text: 'Voltar', callback_data: 'menu:home' }],
            ]));
            logger.info('[UserHandlers] Search mode opened', { userId: ctx.from?.id });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'search:open' });
        }
    }
};

// ============================================================================
// HANDLERS DE FLASH SALES
// ============================================================================

const FlashHandlers = {
    /**
     * flash:sales - Mostra vendas relâmpago
     */
    'flash:sales': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);
            prisma.flashSale.expire();
            const sales = prisma.flashSale.findAllActive();

            if (!sales.length) {
                await uiRespond(ctx,
                    `<b>Nenhuma oferta relâmpago no momento</b>\n\n` +
                    `<i>Promoções com preço e prazo limitados aparecem aqui assim que forem publicadas. ` +
                    `Enquanto isso, confira o catálogo completo.</i>`,
                    Markup.inlineKeyboard([
                        [{ text: 'Ver catálogo', callback_data: 'cat' }],
                        [{ text: 'Menu principal', callback_data: 'home' }],
                    ])
                );
                return;
            }

            const { renderFlashSaleAtIndex } = require('../modules/flash/flashSaleUi');
            await renderFlashSaleAtIndex(ctx, sales, 0, { groupGuard, getBotUsername });

            logger.info('[UserHandlers] Flash sales shown', { userId: ctx.from?.id, count: sales.length });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'flash:sales' });
        }
    },

    /**
     * flash:nav:* - Navegação entre flash sales
     */
    'flash:nav:*': async (ctx, [index]) => {
        try {
            await safeAnswerCbQuery(ctx);
            prisma.flashSale.expire();
            const sales = prisma.flashSale.findAllActive();
            if (!sales.length) {
                return safeAnswerCbQuery(ctx, 'Todas as ofertas expiraram!', { show_alert: true });
            }
            const idx = Math.min(parseInt(index, 10) || 0, sales.length - 1);
            const { renderFlashSaleAtIndex } = require('../modules/flash/flashSaleUi');
            await renderFlashSaleAtIndex(ctx, sales, idx, { groupGuard, getBotUsername });
            logger.info('[UserHandlers] Flash navigation', { userId: ctx.from?.id, index: idx });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'flash:nav' });
        }
    },

    /**
     * flash:buy:* - Compra rápida flash sale (delega para fs_buy quando possível)
     */
    'flash:buy:*': async (ctx, [productId]) => {
        try {
            await safeAnswerCbQuery(ctx, 'Processando...');
            const pid = parseInt(productId, 10);
            if (!pid) throw new Error('Invalid product ID');

            prisma.flashSale.expire();
            const sale = prisma.flashSale.findActive(pid);
            if (sale) {
                const { flashBuyBtn } = require('../utils/buttonLabels');
                await uiRespond(ctx,
                    '<b>Oferta relâmpago</b>\n\nPreço promocional por tempo limitado. Toque abaixo para comprar:',
                    Markup.inlineKeyboard([
                        [{ text: flashBuyBtn(sale.sale_price), callback_data: `fs_buy_${pid}_${sale.id}` }],
                        [{ text: 'Menu principal', callback_data: 'home' }],
                    ])
                );
                return;
            }

            const { Cart, cartKey } = require('../telegram/callbacks/BotContext').requireBotContext(['Cart', 'cartKey']);
            const key = cartKey(ctx);
            await Cart.clear(key);
            await Cart.add(key, pid, 1);

            await uiRespond(ctx,
                '<b>Compra rápida</b>\n\nProduto no carrinho! Finalize a compra:',
                Markup.inlineKeyboard([
                    [{ text: 'Finalizar compra', callback_data: 'checkout' }],
                    [{ text: 'Ver carrinho', callback_data: 'cart' }],
                    [{ text: 'Menu principal', callback_data: 'home' }],
                ])
            );
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'flash:buy', productId });
        }
    }
};

// ============================================================================
// HANDLERS DE USUÁRIO (Favoritos, Afiliado, etc)
// ============================================================================

const UserFeatureHandlers = {
    /**
     * user:favoritos - Lista de favoritos
     */
    'user:favoritos': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);

            const user = await prisma.user.findUnique({
                where: { telegram_id: ctx.from.id.toString() }
            });

            if (!user) {
                await Msg.reply(ctx, 'Faça /start primeiro');
                return;
            }

            const favIds = await prisma.favorite?.findByUser?.(user.id) || [];

            if (favIds.length === 0) {
                await uiRespond(ctx, '<b>Seus favoritos</b>\n\nVocê ainda não tem produtos favoritos.\n\nMarque favoritos nos produtos para adicionar!', Markup.inlineKeyboard([
                            [{ text: 'Ver catálogo', callback_data: 'cat' }],
                            [{ text: 'Voltar', callback_data: 'menu:minha_conta' }]
                        ]));
                return;
            }

            // Buscar detalhes dos produtos favoritos
            const favProds = await Promise.all(
                favIds.map((id) => prisma.product.findUnique({ where: { id } }))
            );

            const validProds = favProds.filter(p => p);
            
            const rows = validProds.map(p => [
                { text: `${p.name} - R$ ${p.price.toFixed(2)}`, callback_data: `p_${p.id}` }
            ]);
            rows.push([{ text: 'Voltar', callback_data: 'menu:minha_conta' }]);

            await uiRespond(ctx, `<b>Seus favoritos</b> (${validProds.length})`, Markup.inlineKeyboard(rows));

            logger.info('[UserHandlers] Favorites shown', { 
                userId: ctx.from?.id, 
                count: validProds.length 
            });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'user:favoritos' });
        }
    },

    /**
     * user:wallet - Carteira Hanork (saldo reutilizável)
     */
    'user:wallet': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);

            if (groupGuard.isGroupChat(ctx)) {
                await groupGuard.replyGroupRedirect(ctx, ctx.telegram, {
                    body: 'Sua carteira só está disponível em conversa privada com o bot.',
                });
                return;
            }

            const user = await prisma.user.findUnique({
                where: { telegram_id: ctx.from.id.toString() },
            });
            if (!user) {
                await Msg.reply(ctx, 'Faça /start primeiro.');
                return;
            }

            const UserWalletService = require('../services/UserWalletService');
            const { buildWalletPanelText, walletPanelKeyboard } = require('../modules/user/WalletPanels');
            const balance = UserWalletService.getBalance(user.id);
            const ledger = UserWalletService.listRecentLedger(user.id, 8);
            const text = buildWalletPanelText(user, balance, ledger);

            await uiRespond(ctx, text, walletPanelKeyboard());
            logger.info('[UserHandlers] Wallet panel shown', { userId: ctx.from?.id, balance });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'user:wallet' });
        }
    },

    /**
     * user:afiliado - Painel de afiliado
     */
    'user:afiliado': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);

            const user = await prisma.user.findUnique({
                where: { telegram_id: ctx.from.id.toString() }
            });

            if (!user) {
                await Msg.reply(ctx, 'Faça /start primeiro');
                return;
            }

            const aff = await ensureAffiliateForUser(user, ctx.from.id);
            const botUsername = await getBotUsername(ctx);
            const text = AffiliatePanels.buildAffiliatePanelText(aff, botUsername);

            await uiRespond(ctx, text, AffiliatePanels.affiliatePanelKeyboard(false));

            logger.info('[UserHandlers] Affiliate panel shown', { userId: ctx.from?.id });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'user:afiliado' });
        }
    },

    /**
     * user:indicar - Compartilhar link de indicação
     */
    'user:indicar': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);

            const user = await prisma.user.findUnique({
                where: { telegram_id: ctx.from.id.toString() }
            });

            if (!user) {
                await Msg.reply(ctx, 'Faça /start primeiro');
                return;
            }

            const aff = await ensureAffiliateForUser(user, ctx.from.id);
            const botUsername = await getBotUsername(ctx);
            const link = AffiliateCore.affiliateStartLink(botUsername, aff.code);
            const text = AffiliatePanels.buildSharePanelText(aff, botUsername);

            await uiRespond(ctx, text, AffiliatePanels.shareKeyboard(link));

            logger.info('[UserHandlers] Share link shown', { userId: ctx.from?.id });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'user:indicar' });
        }
    },

    /**
     * user:cupom - Gerenciar cupons
     */
    'user:cupom': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);
            
            // Verificar cupons do usuário
            const user = await prisma.user.findUnique({
                where: { telegram_id: ctx.from.id.toString() }
            });

            if (!user) {
                await Msg.reply(ctx, 'Faça /start primeiro');
                return;
            }

            // Buscar cupons disponíveis para o usuário
            const coupons = prisma.coupon.findAvailable(10);

            if (coupons.length === 0) {
                await uiRespond(ctx, '<b>Meus cupons</b>\n\nVocê não tem cupons ativos no momento.\n\nFique de olho nas promoções!', Markup.inlineKeyboard([
                            [{ text: 'Ver catálogo', callback_data: 'cat' }],
                            [{ text: 'Voltar', callback_data: 'menu:minha_conta' }]
                        ]));
                return;
            }

            let text = '<b>Meus cupons</b>\n\n';
            
            coupons.forEach(c => {
                const discount = c.type === 'percent' ? `${c.value}% OFF` : `R$ ${c.value} OFF`;
                text += `• <code>${c.code}</code> — ${discount}\n`;
            });

            text += '\nUse no checkout para aplicar o desconto!';

            await uiRespond(ctx, text, Markup.inlineKeyboard([
                    [{ text: 'Ir às compras', callback_data: 'cat' }],
                    [{ text: 'Voltar', callback_data: 'menu:minha_conta' }]
                ]));

            logger.info('[UserHandlers] Coupons shown', { 
                userId: ctx.from?.id, 
                count: coupons.length 
            });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'user:cupom' });
        }
    },

    /**
     * user:avaliacoes - Avaliações do usuário
     */
    'user:avaliacoes': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);
            
            const user = await prisma.user.findUnique({
                where: { telegram_id: ctx.from.id.toString() }
            });

            if (!user) {
                await Msg.reply(ctx, 'Faça /start primeiro');
                return;
            }

            const reviews = await prisma.review?.findByUser?.(user.id) || [];

            if (reviews.length === 0) {
                await uiRespond(ctx,
                    '⭐ <b>Minhas Avaliações</b>\n\nVocê ainda não avaliou nenhum produto.\n\nApós comprar, deixe sua avaliação!',
                    Markup.inlineKeyboard([
                        [{ text: 'Meus pedidos', callback_data: 'order:list' }],
                        [{ text: 'Voltar', callback_data: 'menu:minha_conta' }],
                    ])
                );
                return;
            }

            let text = '⭐ <b>Minhas Avaliações</b>\n\n';

            for (const r of reviews.slice(0, 10)) {
                const stars = '⭐'.repeat(Math.min(5, Math.max(1, r.rating || 1)));
                text += `• Pedido #${String(r.order_id || '').slice(-8) || r.id}: ${stars}\n`;
                if (r.comment) text += `  <i>"${String(r.comment).substring(0, 50)}"</i>\n`;
            }

            await uiRespond(ctx, text, Markup.inlineKeyboard([
                    [{ text: 'Voltar', callback_data: 'menu:minha_conta' }]
                ]));

            logger.info('[UserHandlers] Reviews shown', { 
                userId: ctx.from?.id, 
                count: reviews.length 
            });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'user:avaliacoes' });
        }
    },

    /**
     * user:rendimentos - Rendimentos de afiliado
     */
    'user:rendimentos': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);

            const user = await prisma.user.findUnique({
                where: { telegram_id: ctx.from.id.toString() }
            });

            if (!user) {
                await Msg.reply(ctx, 'Faça /start primeiro');
                return;
            }

            const aff = await ensureAffiliateForUser(user, ctx.from.id);
            const earnings = affSaldo(aff);
            const text = AffiliatePanels.buildRendimentosText(aff, user.id);

            await uiRespond(ctx, text, AffiliatePanels.rendimentosKeyboard(user.id, earnings));

            logger.info('[UserHandlers] Affiliate earnings shown', { userId: ctx.from?.id });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'user:rendimentos' });
        }
    }
};

// ============================================================================
// HANDLERS DE E-MAIL
// ============================================================================

const EmailHandlers = {
    'user:email:start': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);
            if (groupGuard.isGroupChat(ctx)) {
                await groupGuard.replyGroupRedirect(ctx, ctx.telegram, {
                    body: 'Cadastre seu e-mail em conversa privada com o bot.',
                });
                return;
            }
            const { campanhaEmailMode } = requireBotContext(['campanhaEmailMode']);
            await UserEmailService.startRegistration(ctx, campanhaEmailMode);
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'user:email:start' });
        }
    },
    'user:email:resend': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx, 'Reenviando...');
            const { campanhaEmailMode } = requireBotContext(['campanhaEmailMode']);
            await UserEmailService.resendCode(ctx, campanhaEmailMode);
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'user:email:resend' });
        }
    },
    'user:email:remove': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);
            const { campanhaEmailMode } = requireBotContext(['campanhaEmailMode']);
            await campanhaEmailMode.delete(ctx.from?.id);
            await UserEmailService.removeEmail(ctx);
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'user:email:remove' });
        }
    },
    'user:email:help': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);
            await UserEmailService.showEmailHelp(ctx);
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'user:email:help' });
        }
    },
};

// ============================================================================
// HANDLERS DE ASSINATURA
// ============================================================================

const SubscriptionHandlers = {
    /**
     * subscription:view - Ver assinatura atual
     */
    'subscription:view': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);

            const user = await prisma.user.findUnique({
                where: { telegram_id: ctx.from.id.toString() }
            });

            if (!user) {
                await Msg.reply(ctx, 'Inicie o bot com /start');
                return;
            }

            if (isWaDivulgacaoEnabled()) {
                await sendWaDivulgacaoHome(ctx);
                logger.info('[UserHandlers] Hanork Div view shown', { userId: ctx.from?.id });
                return;
            }

            const sub = CustomerSubscriptionService.findActive(user.id);

            if (sub) {
                await uiRespond(
                    ctx,
                    CustomerSubscriptionService.formatActivePanel(sub),
                    UserAccountPanels.subscriptionActiveKeyboard(sub)
                );
            } else {
                const products = CustomerSubscriptionService.listSubscriptionProducts();
                const product = products[0] || null;
                if (!product) {
                    await UX.showDevMode(ctx, 'Assinaturas');
                    return;
                }
                await uiRespond(
                    ctx,
                    CustomerSubscriptionService.formatInactivePanel(products),
                    UserAccountPanels.subscriptionInactiveKeyboard(product)
                );
            }

            logger.info('[UserHandlers] Subscription view shown', { userId: ctx.from?.id });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'subscription:view' });
        }
    },

    'subscription:cancel': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);
            const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
            if (!user) return uiRespond(ctx, 'Faça /start primeiro.');

            if (isWaDivulgacaoEnabled() && WaDivulgacaoSubscriptionService.findActive(user.id)) {
                return WaDivulgacaoHandlers['wadv:cancel'](ctx);
            }

            const sub = CustomerSubscriptionService.findActive(user.id);
            if (!sub || sub.status === 'cancelled') {
                return uiRespond(ctx, 'ℹ️ Não há renovação ativa para cancelar.', Markup.inlineKeyboard([
                    [{ text: 'Voltar à assinatura', callback_data: 'subscription:view' }],
                ]));
            }

            const ok = CustomerSubscriptionService.cancel(user.id);
            if (!ok) {
                return uiRespond(ctx, 'Não foi possível cancelar. Tente novamente ou fale com o suporte.', Markup.inlineKeyboard([
                    [{ text: 'Voltar à assinatura', callback_data: 'subscription:view' }],
                ]));
            }

            const next = sub.next_payment_date ? new Date(sub.next_payment_date).toLocaleDateString('pt-BR') : '—';
            await uiRespond(
                ctx,
                `<b>Renovação cancelada</b>\n\n` +
                `Seus benefícios Premium continuam até <b>${next}</b>.\n\n` +
                `Para renovar depois, use /assinatura e compre o plano novamente.`,
                Markup.inlineKeyboard([
                    [{ text: 'Ver assinatura', callback_data: 'subscription:view' }],
                    [{ text: 'Minha conta', callback_data: 'menu:minha_conta' }],
                ])
            );
            logger.info('[Subscription] Cancelada renovação', { userId: user.id });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'subscription:cancel' });
        }
    },

    /**
     * subscription:buy:* - Comprar assinatura
     */
    'subscription:buy:*': async (ctx, [productId]) => {
        try {
            await safeAnswerCbQuery(ctx, 'Preparando assinatura...');
            
            const pid = parseInt(productId);
            if (!pid) {
                throw new Error('Invalid subscription product ID');
            }

            // Adicionar ao carrinho e ir para checkout
            const { Cart, cartKey } = require('../telegram/callbacks/BotContext').requireBotContext(['Cart', 'cartKey']);
            const key = cartKey(ctx);

            await Cart.clear(key);
            await Cart.add(key, pid, 1);

            await uiRespond(
                ctx,
                '<b>Assinatura premium</b>\n\nProduto adicionado ao carrinho!\n\nFinalize a compra para ativar seus benefícios.',
                Markup.inlineKeyboard([
                    [{ text: 'Finalizar compra', callback_data: 'cart' }],
                    [{ text: 'Voltar', callback_data: 'subscription:view' }],
                ])
            );

            logger.info('[UserHandlers] Subscription buy initiated', { 
                userId: ctx.from?.id, 
                productId: pid 
            });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'subscription:buy', productId });
        }
    }
};

// ============================================================================
// HANDLERS DE PEDIDOS
// ============================================================================

const OrderHandlers = {
    /**
     * order:list - Lista de pedidos
     */
    'order:list': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);
            
            const user = await prisma.user.findUnique({
                where: { telegram_id: ctx.from.id.toString() }
            });

            if (!user) {
                await Msg.reply(ctx, 'Faça /start primeiro');
                return;
            }

            const orders = await prisma.order?.findMany?.({
                where: { user_id: user.id },
                orderBy: { created_at: 'desc' },
                take: 10
            }) || [];

            if (orders.length === 0) {
                await uiRespond(ctx, '<b>Meus pedidos</b>\n\nVocê ainda não fez nenhum pedido.\n\nQue tal dar uma olhada no catálogo?', Markup.inlineKeyboard([
                            [{ text: 'Ver catálogo', callback_data: 'cat' }],
                            [{ text: 'Voltar', callback_data: 'menu:minha_conta' }]
                        ]));
                return;
            }

            let text = '<b>Meus pedidos</b>\n\n';
            
            orders.forEach(o => {
                const status = {
                    'WAITING_PAYMENT': 'Aguardando pagamento',
                    'PAID': 'Pago',
                    'DELIVERED': 'Entregue',
                    'CANCELLED': 'Cancelado',
                    'FAILED': 'Cancelado'
                }[o.status] || o.status;
                
                text += `• #${o.id.toString().slice(-8)} — ${status}\n`;
                text += `  R$ ${o.total.toFixed(2)} — ${new Date(o.created_at).toLocaleDateString('pt-BR')}\n\n`;
            });

            await uiRespond(ctx, text, Markup.inlineKeyboard([
                    [{ text: 'Rastrear pedido', callback_data: 'order:track' }],
                    [{ text: 'Voltar', callback_data: 'menu:minha_conta' }]
                ]));

            logger.info('[UserHandlers] Order list shown', { 
                userId: ctx.from?.id, 
                count: orders.length 
            });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'order:list' });
        }
    },

    /**
     * order:track - Rastrear pedido
     */
    'order:track': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);

            const user = await prisma.user.findUnique({
                where: { telegram_id: ctx.from.id.toString() },
            });

            if (!user) {
                await Msg.reply(ctx, 'Faça /start primeiro');
                return;
            }

            const orders = (await prisma.order.findMany({ where: { user_id: user.id } }))
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 5);

            if (!orders.length) {
                await uiRespond(ctx, '<b>Rastrear pedido</b>\n\nVocê não tem pedidos para rastrear.', Markup.inlineKeyboard([
                    [{ text: 'Ver catálogo', callback_data: 'cat' }],
                    [{ text: 'Voltar', callback_data: 'menu:minha_conta' }],
                ]));
                return;
            }

            const OrderTrackingService = require('../services/OrderTrackingService');
            const text = await OrderTrackingService.buildTrackingText(orders, { max: 3 });
            const kb = await OrderTrackingService.buildTrackingKeyboard(orders);

            await uiRespond(ctx, text, kb);

            logger.info('[UserHandlers] Order tracking shown', {
                userId: ctx.from?.id,
                count: orders.length,
            });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'order:track' });
        }
    },

    /**
     * order:resend_list - Lista pedidos para reenvio
     */
    'order:resend_list': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);
            const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
            if (!user) {
                await Msg.reply(ctx, 'Faça /start primeiro');
                return;
            }
            const ResendService = require('../services/ResendService');
            const orders = (await prisma.order.findMany({ where: { user_id: user.id } }))
                .filter((o) => o.status === 'DELIVERED')
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 5);
            if (!orders.length) {
                await uiRespond(ctx, '<b>Reenviar produto</b>\n\nNenhum pedido entregue.', Markup.inlineKeyboard([
                    [{ text: 'Voltar', callback_data: 'menu:minha_conta' }],
                ]));
                return;
            }
            await uiRespond(ctx, ResendService.LIST_TEXT, ResendService.buildResendListKeyboard(orders));
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'order:resend_list' });
        }
    },

    /**
     * order:resend - Atalho: abre lista (evita reenvio automático do pedido errado)
     */
    'order:resend': async (ctx) => {
        return OrderHandlers['order:resend_list'](ctx);
    },
};

// ============================================================================
// HANDLERS DE PAGAMENTO
// ============================================================================

const PaymentHandlers = {
    /**
     * payment:aff:* - Pagar com saldo afiliado
     */
    'payment:aff:*': async (ctx, [orderId]) => {
        try {
            await safeAnswerCbQuery(ctx, 'Processando pagamento...');
            const deps = requireBotContext([
                'cartKey', 'comprasPendentes', 'prisma', 'Markup', 'Msg',
                'deliverProducts', 'payAffiliateCommission',
            ]);
            await AffiliatePaymentService.processAffiliatePayment(ctx, orderId, deps);
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'payment:aff', orderId });
        }
    },

    /**
     * payment:check:* — UI de status (registry).
     * Fluxo financeiro real: router delega payment:check:* → check_{orderId} → bot.js (MP + SafeWebhookHandler).
     * Botões "Atualizar" com payment:check: também passam pelo legado check_.
     */
    'payment:check:*': async (ctx, [orderId]) => {
        try {
            await safeAnswerCbQuery(ctx, 'Verificando...');

            const user = await prisma.user.findUnique({
                where: { telegram_id: String(ctx.from.id) },
            });
            if (!user) {
                await Msg.reply(ctx, 'Faça /start primeiro');
                return;
            }

            const order = await prisma.order.findUnique({ where: { id: orderId } });

            if (!order) {
                await uiRespond(ctx, '<b>Pedido não encontrado</b>\n\nVerifique o número do pedido.', Markup.inlineKeyboard([
                            [{ text: 'Meus pedidos', callback_data: 'order:list' }],
                            [{ text: 'Voltar', callback_data: 'menu:home' }]
                        ]));
                return;
            }
            if (order.user_id !== user.id) {
                await uiRespond(ctx, 'Este pedido não é seu.', Markup.inlineKeyboard([[{ text: 'Voltar', callback_data: 'menu:home' }]]));
                return;
            }

            const status = {
                WAITING_PAYMENT: { text: 'Aguardando pagamento', action: 'Use Já paguei na tela do PIX' },
                PAID: { text: 'Pagamento confirmado', action: 'Produto sendo preparado' },
                DELIVERING: { text: 'Em entrega', action: 'Aguarde alguns instantes' },
                DELIVERED: { text: 'Entregue', action: 'Aproveite seu produto' },
                FAILED: { text: 'Cancelado', action: 'Faça um novo pedido' },
                CANCELLED: { text: 'Cancelado', action: 'Faça um novo pedido' },
            }[order.status] || { text: order.status, action: '' };

            const text = `<b>Verificação de pagamento</b>

<b>Pedido:</b> #${orderId.slice(-8)}
<b>Status:</b> ${status.text}

${status.action ? `${status.action}` : ''}`;

            const buttons = [
                [{ text: 'Atualizar', callback_data: `payment:check:${orderId}` }]
            ];

            if (order.status === 'PAID' || order.status === 'DELIVERED') {
                buttons.push([{ text: 'Rastrear pedido', callback_data: 'order:track' }]);
            }

            buttons.push([{ text: 'Voltar', callback_data: 'cart' }]);

            await uiRespond(ctx, text, Markup.inlineKeyboard(buttons));

            logger.info('[UserHandlers] Payment check', { 
                userId: ctx.from?.id, 
                orderId,
                status: order.status 
            });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'payment:check', orderId });
        }
    }
};

// ============================================================================
// HANDLERS DE AJUDA
// ============================================================================

const HelpHandlers = {
    /**
     * help:open - Central de ajuda
     */
    'help:open': async (ctx) => {
        try {
            const { safeAnswerCbQuery } = require('../utils/safeTelegram');
            await safeAnswerCbQuery(ctx);

            if (groupGuard.isGroupChat(ctx)) {
                const uname = await getBotUsername(ctx);
                const text =
                    `<b>Ajuda no grupo</b>\n\n` +
                    `Aqui você pode <b>consultar o catálogo</b> e ver ofertas publicadas.\n\n` +
                    `<b>Compras, pagamentos, pedidos e dados da conta</b> ficam protegidos no chat privado com o bot — ` +
                    `toque em <b>Abrir no privado</b> para continuar com segurança.`;
                await uiRespond(ctx, text, Markup.inlineKeyboard([
                    [{ text: 'Catálogo de produtos', callback_data: 'catalog:view' }],
                    [{ text: 'Abrir no privado', url: groupGuard.privateUrl(uname) }],
                    [{ text: 'Voltar ao início', callback_data: 'menu:home' }],
                ]));
                return;
            }
            
            const adminIds = (process.env.ID_DONO || '')
                .split(',')
                .map((id) => parseInt(id.trim(), 10))
                .filter(Boolean);
            const isAdminUser = adminIds.includes(ctx.from?.id);

            const text =
                `<b>Central de ajuda Hanork</b>\n\n` +
                `<b>O que é este bot?</b>\n` +
                `Loja digital no Telegram: você compra, paga e recebe produtos digitais aqui no chat.\n\n` +
                `<b>Como comprar (passo a passo):</b>\n` +
                `1. <b>Loja</b> ou <code>/cat</code> — escolha o produto\n` +
                `2. <b>Adicionar</b> ou <b>Comprar</b> — monte o carrinho\n` +
                `3. <code>/checkout</code> — pague com PIX ou cartão\n` +
                `4. Entrega automática após confirmação do pagamento\n\n` +
                `<b>Atalhos úteis:</b>\n` +
                `• <code>/carrinho</code> ver itens | <code>/rastrear</code> — status do pedido\n` +
                `• <code>/downloads</code> — baixar de YouTube, TikTok, Instagram\n` +
                `• <code>/hanork</code> — assistente com dúvidas sobre a loja\n\n` +
                (isAdminUser
                    ? `<b>Admin:</b> <code>/admin</code> | <code>/gerenciarprodutos</code> | <code>/addproduto</code>\n\n`
                    : '') +
                `<i>Detalhes de cada função em <b>Ver comandos</b> abaixo.</i>`;

            const rows = [
                [{ text: 'Catálogo de produtos', callback_data: 'cat' }, { text: 'Lista de comandos', callback_data: 'help_sec_user' }],
                [{ text: 'Downloads', callback_data: 'downloads:open' }, { text: 'Ver /help', callback_data: 'help_sec_all' }],
                [{ text: 'Assistente Hanork', callback_data: 'hanork:open' }],
                [{ text: 'Voltar', callback_data: 'menu:home' }],
            ];
            if (isAdminUser) {
                rows.splice(2, 0, [
                    { text: 'Admin', callback_data: 'help_sec_admin' },
                    { text: 'Produtos', callback_data: 'help_sec_produtos' },
                ]);
                rows.splice(3, 0, [{ text: 'Divulgação', callback_data: 'help_sec_divulgacao' }]);
                if (require('../plugins/zero-divu/config').isZeroDivuEnabled()) {
                    rows.splice(4, 0, [{ text: 'WhatsApp', callback_data: 'help_sec_whatsapp' }]);
                }
            }

            await uiRespond(ctx, text, Markup.inlineKeyboard(rows));

            logger.info('[UserHandlers] Help shown', { userId: ctx.from?.id });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'help:open' });
        }
    }
};

// ============================================================================
// HANDLERS NOOP (Operações inválidas/esgotado)
// ============================================================================

const NoopHandlers = {
    'noop': async (ctx) => {
        await UX.showUnavailable(
            ctx,
            'Opção indisponível. Se for saque de afiliado, abra de novo: Afiliado → Rendimentos.'
        );
    },

    'noop:*': async (ctx) => {
        await UX.showUnavailable(
            ctx,
            'Opção indisponível. Se for saque de afiliado, abra de novo: Afiliado → Rendimentos.'
        );
    },
};

// ============================================================================
// HANDLERS DE DESENVOLVIMENTO (Funcionalidades futuras)
// ============================================================================

const WithdrawHandlers = {
    'user:withdraw:min': async (ctx) => WithdrawHandlers['user:withdraw'](ctx),
    'user:withdraw': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);
            const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
            if (!user) return uiRespond(ctx, 'Faça /start primeiro.');
            const aff = await ensureAffiliateForUser(user, ctx.from.id);
            if (!aff) {
                return uiRespond(
                    ctx,
                    'Você ainda não é afiliado.\n\nUse /afiliado para começar.',
                    Markup.inlineKeyboard([[{ text: 'Voltar', callback_data: 'user:rendimentos' }]])
                );
            }
            const db = dbRaw();
            const pending = db.prepare("SELECT id FROM affiliate_withdrawals WHERE user_id = ? AND status = 'pending'").get(user.id);
            if (pending) {
                return uiRespond(
                    ctx,
                    '<b>Saque em análise</b>\n\nVocê já tem uma solicitação pendente.\n\nO suporte pode pedir seus dados PIX por aqui ou no chat de suporte.',
                    Markup.inlineKeyboard([
                        [{ text: 'Ver status do saque', callback_data: 'user:withdraw_status' }],
                        ...AffiliatePanels.withdrawSupportRows('user:rendimentos'),
                    ])
                );
            }
            const amount = affSaldo(aff);
            if (amount < AFF_WITHDRAW_MIN) {
                return uiRespond(
                    ctx,
                    `<b>Saque de afiliado</b>\n\n` +
                    `Seu saldo: <b>R$ ${amount.toFixed(2)}</b>\n` +
                    `Mínimo para saque: <b>R$ ${AFF_WITHDRAW_MIN.toFixed(2)}</b>\n\n` +
                    `Continue indicando clientes para atingir o mínimo.\n\n` +
                    `Precisa de ajuda ou quer combinar saque com o suporte? Fale conosco — quando for aprovado, informe sua chave PIX.`,
                    Markup.inlineKeyboard(AffiliatePanels.withdrawSupportRows('user:rendimentos'))
                );
            }
            await uiRespond(
                ctx,
                `<b>Solicitar saque</b>\n\n` +
                `Valor disponível: <b>R$ ${amount.toFixed(2)}</b>\n\n` +
                `Ao confirmar, o valor fica reservado até o suporte aprovar.\n` +
                `Depois da aprovação, envie sua chave PIX se o suporte solicitar.\n\n` +
                `Confirmar solicitação?`,
                Markup.inlineKeyboard([
                    [{ text: 'Confirmar saque', callback_data: 'user:withdraw_confirm' }],
                    [{ text: 'Falar com suporte antes', url: process.env.CONTATO_ESPECIALISTA || 'https://t.me/hanorkoff' }],
                    [{ text: 'Cancelar', callback_data: 'user:rendimentos' }],
                ])
            );
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'user:withdraw' });
        }
    },
    'user:withdraw_confirm': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx, 'Enviando...');
            const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
            if (!user) return uiRespond(ctx, 'Faça /start primeiro.');
            const aff = await ensureAffiliateForUser(user, ctx.from.id);
            if (!aff) return uiRespond(ctx, 'Afiliado não encontrado.');
            const db = dbRaw();
            const pending = db.prepare("SELECT id FROM affiliate_withdrawals WHERE user_id = ? AND status = 'pending'").get(user.id);
            if (pending) {
                return uiRespond(ctx, 'Saque já em análise.', Markup.inlineKeyboard([[{ text: 'Voltar', callback_data: 'user:rendimentos' }]]));
            }
            const amount = affSaldo(aff);
            if (amount < AFF_WITHDRAW_MIN) {
                return uiRespond(ctx, `Saldo abaixo do mínimo (R$ ${AFF_WITHDRAW_MIN.toFixed(2)}).`, Markup.inlineKeyboard([[{ text: 'Voltar', callback_data: 'user:rendimentos' }]]));
            }

            let wdId;
            const ok = db.transaction(() => {
                const stillPending = db.prepare(
                    "SELECT id FROM affiliate_withdrawals WHERE user_id = ? AND status = 'pending'"
                ).get(user.id);
                if (stillPending) return false;

                const reserved = db.prepare(
                    'UPDATE affiliates SET earnings = earnings - ? WHERE id = ? AND earnings >= ?'
                ).run(amount, aff.id, amount);
                if (reserved.changes < 1) return false;

                const info = db.prepare(
                    'INSERT INTO affiliate_withdrawals (user_id, affiliate_id, amount, status) VALUES (?, ?, ?, ?)'
                ).run(user.id, aff.id, amount, 'pending');
                wdId = info.lastInsertRowid;
                return true;
            })();

            if (!ok) {
                return uiRespond(ctx, 'Não foi possível reservar o saldo. Tente novamente.', Markup.inlineKeyboard([[{ text: 'Voltar', callback_data: 'user:rendimentos' }]]));
            }
            const nome = user.first_name || user.username || user.telegram_id;
            const adminMsg =
                `<b>Saque afiliado #${wdId}</b>\n\n` +
                `Cliente: ${nome} (<code>${user.telegram_id}</code>)\n` +
                `R$ ${amount.toFixed(2)}\n` +
                `Código: <code>${aff.code}</code>`;
            const adminKb = Markup.inlineKeyboard([
                [{ text: 'Aprovar', callback_data: `aff_wd_ok_${wdId}` }, { text: 'Recusar', callback_data: `aff_wd_no_${wdId}` }],
            ]);
            for (const adminId of getAdminTelegramIds()) {
                try {
                    await ctx.telegram.sendMessage(adminId, adminMsg, { parse_mode: 'HTML', ...adminKb });
                } catch { /* admin inacessível */ }
            }
            await uiRespond(ctx,
                `<b>Solicitação enviada!</b>\n\nR$ ${amount.toFixed(2)} em análise.\nPrazo habitual: até 3 dias úteis.\n\nVocê será avisado aqui no bot.`,
                Markup.inlineKeyboard([[{ text: 'Voltar aos rendimentos', callback_data: 'user:rendimentos' }]]));
            logger.info('[Withdraw] requested', { wdId, userId: user.id, amount });
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'user:withdraw_confirm' });
        }
    },
    'user:withdraw_status': async (ctx) => {
        try {
            await safeAnswerCbQuery(ctx);
            const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
            if (!user) {
                return uiRespond(ctx, 'Faça /start primeiro.');
            }
            const row = dbRaw().prepare("SELECT id, amount, status, created_at FROM affiliate_withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(user.id);
            if (!row) {
                return uiRespond(ctx, 'Nenhum saque encontrado.', Markup.inlineKeyboard([[{ text: 'Voltar', callback_data: 'user:rendimentos' }]]));
            }
            const st = AffiliatePanels.formatWithdrawStatus(row.status);
            await uiRespond(
                ctx,
                `<b>Saque #${row.id}</b>\n\n` +
                `Valor: <b>R$ ${Number(row.amount).toFixed(2)}</b>\n` +
                `Status: ${st}\n` +
                `Solicitado: ${(row.created_at || '').slice(0, 16).replace('T', ' ')}\n\n` +
                (row.status === 'approved'
                    ? `<i>Se ainda não recebeu, confirme sua chave PIX com o suporte.</i>`
                    : row.status === 'pending'
                        ? `<i>Análise em até 3 dias úteis. Você será avisado aqui.</i>`
                        : `<i>O valor foi devolvido ao seu saldo afiliado.</i>`),
                Markup.inlineKeyboard([[{ text: 'Voltar', callback_data: 'user:rendimentos' }]])
            );
        } catch (error) {
            await UX.showError(ctx, error, { handler: 'user:withdraw_status' });
        }
    },
};

const DevHandlers = {
    /**
     * dev:* - Tela de "Em Desenvolvimento"
     */
    'dev:*': async (ctx, [feature]) => {
        if (feature === 'restock_notify') {
            await safeAnswerCbQuery(
                ctx,
                'Abra o produto esgotado no catálogo e toque em <b>Avisar restock</b>.',
                { show_alert: true }
            );
            return;
        }

        const featureNames = {
            'cancel_sub': 'Cancelar Assinatura',
            'advanced_search': 'Busca Avançada',
        };

        await UX.showDevMode(ctx, featureNames[feature] || 'Funcionalidade');
    }
};

// ============================================================================
// EXPORTAÇÃO DE TODOS OS HANDLERS
// ============================================================================

const AllHandlers = {
    // Menu
    'menu:home': MenuHandlers['menu:home'],
    'ref:verify': MenuHandlers['ref:verify'],
    'menu:minha_conta': MenuHandlers['menu:minha_conta'],
    
    // Busca
    'search:open': SearchHandlers['search:open'],
    
    // Flash Sales
    'flash:sales': FlashHandlers['flash:sales'],
    'flash:nav:*': FlashHandlers['flash:nav:*'],
    'flash:buy:*': FlashHandlers['flash:buy:*'],
    
    // Usuário
    'user:favoritos': UserFeatureHandlers['user:favoritos'],
    'user:wallet': UserFeatureHandlers['user:wallet'],
    'user:afiliado': UserFeatureHandlers['user:afiliado'],
    'user:indicar': UserFeatureHandlers['user:indicar'],
    'user:cupom': UserFeatureHandlers['user:cupom'],
    'user:avaliacoes': UserFeatureHandlers['user:avaliacoes'],
    'user:rendimentos': UserFeatureHandlers['user:rendimentos'],
    'user:withdraw:min': WithdrawHandlers['user:withdraw:min'],
    'user:withdraw': WithdrawHandlers['user:withdraw'],
    'user:withdraw_confirm': WithdrawHandlers['user:withdraw_confirm'],
    'user:withdraw_status': WithdrawHandlers['user:withdraw_status'],

    // E-mail
    'user:email:start': EmailHandlers['user:email:start'],
    'user:email:resend': EmailHandlers['user:email:resend'],
    'user:email:remove': EmailHandlers['user:email:remove'],
    'user:email:help': EmailHandlers['user:email:help'],
    
    // Assinatura
    'subscription:view': SubscriptionHandlers['subscription:view'],
    'subscription:cancel': SubscriptionHandlers['subscription:cancel'],
    'subscription:buy:*': SubscriptionHandlers['subscription:buy:*'],
    
    // Pedidos
    'order:list': OrderHandlers['order:list'],
    'order:track': OrderHandlers['order:track'],
    'order:resend': OrderHandlers['order:resend'],
    'order:resend_list': OrderHandlers['order:resend_list'],
    
    // Pagamento
    'payment:aff:*': PaymentHandlers['payment:aff:*'],
    'payment:check:*': PaymentHandlers['payment:check:*'],
    
    // Ajuda
    'help:open': HelpHandlers['help:open'],

    // Downloads
    'downloads:open': DownloadsHandlers['downloads:open'],
    'downloads:hub': DownloadsHandlers['downloads:hub'],
    'downloads:play': DownloadsHandlers['downloads:play'],
    'downloads:youtube': DownloadsHandlers['downloads:youtube'],
    'downloads:tiktok': DownloadsHandlers['downloads:tiktok'],
    'downloads:instagram': DownloadsHandlers['downloads:instagram'],
    'downloads:ig_stories': DownloadsHandlers['downloads:ig_stories'],
    'downloads:ig_highlights': DownloadsHandlers['downloads:ig_highlights'],

    // Virtuo SMS
    'virtuo:home': VirtuoHandlers['virtuo:home'],
    'virtuo:svc:*': VirtuoHandlers['virtuo:svc:*'],
    'virtuo:ctyp:*': VirtuoHandlers['virtuo:ctyp:*'],
    'virtuo:srch:*': VirtuoHandlers['virtuo:srch:*'],
    'virtuo:quick:*': VirtuoHandlers['virtuo:quick:*'],
    'virtuo:cty:*': VirtuoHandlers['virtuo:cty:*'],
    'virtuo:buy:*': VirtuoHandlers['virtuo:buy:*'],
    'virtuo:orders': VirtuoHandlers['virtuo:orders'],
    'virtuo:noop': VirtuoHandlers['virtuo:noop'],
    'virtuo:sync': VirtuoHandlers['virtuo:sync'],
    'virtuo:bal:refresh': VirtuoHandlers['virtuo:bal:refresh'],
    'virtuo:bal:stats': VirtuoHandlers['virtuo:bal:stats'],
    'virtuo:ordrf:*': VirtuoHandlers['virtuo:ordrf:*'],
    'virtuo:ordcp:*': VirtuoHandlers['virtuo:ordcp:*'],
    'virtuo:ordcc:*': VirtuoHandlers['virtuo:ordcc:*'],
    'virtuo:ordcx:*': VirtuoHandlers['virtuo:ordcx:*'],
    'virtuo:pend:sync': VirtuoHandlers['virtuo:pend:sync'],
    'virtuo:pend:rel': VirtuoHandlers['virtuo:pend:rel'],
    'virtuo:docs:*': VirtuoHandlers['virtuo:docs:*'],

    // Hanork Div — assinatura WhatsApp Divulgação
    'wadv:home': WaDivulgacaoHandlers['wadv:home'],
    'wadv:guide': WaDivulgacaoHandlers['wadv:guide'],
    'wadv:plans': WaDivulgacaoHandlers['wadv:plans'],
    'wadv:buy:*': WaDivulgacaoHandlers['wadv:buy:*'],
    'wadv:connect': WaDivulgacaoHandlers['wadv:connect'],
    'wadv:connect:qr': WaDivulgacaoHandlers['wadv:connect:qr'],
    'wadv:connect:pair': WaDivulgacaoHandlers['wadv:connect:pair'],
    'wadv:connect:retry_pair': WaDivulgacaoHandlers['wadv:connect:retry_pair'],
    'wadv:copy_pair': WaDivulgacaoHandlers['wadv:copy_pair'],
    'wadv:disconnect': WaDivulgacaoHandlers['wadv:disconnect'],
    'wadv:disconnect:yes': WaDivulgacaoHandlers['wadv:disconnect:yes'],
    'wadv:campaigns': WaDivulgacaoHandlers['wadv:campaigns'],
    'wadv:camp:new': WaDivulgacaoHandlers['wadv:camp:new'],
    'wadv:preset:*': WaDivulgacaoHandlers['wadv:preset:*'],
    'wadv:history': WaDivulgacaoHandlers['wadv:history'],
    'wadv:hist:pg:*': WaDivulgacaoHandlers['wadv:hist:pg:*'],
    'wadv:scheduled': WaDivulgacaoHandlers['wadv:scheduled'],
    'wadv:sched:cancel:*': WaDivulgacaoHandlers['wadv:sched:cancel:*'],
    'wadv:camp:cancel': WaDivulgacaoHandlers['wadv:camp:cancel'],
    'wadv:camp:all': WaDivulgacaoHandlers['wadv:camp:all'],
    'wadv:camp:none': WaDivulgacaoHandlers['wadv:camp:none'],
    'wadv:camp:pg:*': WaDivulgacaoHandlers['wadv:camp:pg:*'],
    'wadv:camp:tg:*:*': WaDivulgacaoHandlers['wadv:camp:tg:*:*'],
    'wadv:camp:delay': WaDivulgacaoHandlers['wadv:camp:delay'],
    'wadv:camp:delay:*': WaDivulgacaoHandlers['wadv:camp:delay:*'],
    'wadv:camp:back': WaDivulgacaoHandlers['wadv:camp:back'],
    'wadv:camp:back_mode': WaDivulgacaoHandlers['wadv:camp:back_mode'],
    'wadv:camp:back_text': WaDivulgacaoHandlers['wadv:camp:back_text'],
    'wadv:camp:go': WaDivulgacaoHandlers['wadv:camp:go'],
    'wadv:camp:sched:*': WaDivulgacaoHandlers['wadv:camp:sched:*'],
    'wadv:camp:save_tpl': WaDivulgacaoHandlers['wadv:camp:save_tpl'],
    'wadv:camp:save_list': WaDivulgacaoHandlers['wadv:camp:save_list'],
    'wadv:grp:list:*': WaDivulgacaoHandlers['wadv:grp:list:*'],
    'wadv:settings:pace:*': WaDivulgacaoHandlers['wadv:settings:pace:*'],
    'wadv:settings:hours:*': WaDivulgacaoHandlers['wadv:settings:hours:*'],
    'wadv:camp:mode:*': WaDivulgacaoHandlers['wadv:camp:mode:*'],
    'wadv:camp:cycles:*': WaDivulgacaoHandlers['wadv:camp:cycles:*'],
    'wadv:stats': WaDivulgacaoHandlers['wadv:stats'],
    'wadv:monitor': WaDivulgacaoHandlers['wadv:monitor'],
    'wadv:monitor:busy': WaDivulgacaoHandlers['wadv:monitor:busy'],
    'wadv:monitor:live:*': WaDivulgacaoHandlers['wadv:monitor:live:*'],
    'wadv:session': WaDivulgacaoHandlers['wadv:session'],
    'wadv:status': WaDivulgacaoHandlers['wadv:status'],
    'wadv:auto': WaDivulgacaoHandlers['wadv:auto'],
    'wadv:utils': WaDivulgacaoHandlers['wadv:utils'],
    'wadv:my_wa': WaDivulgacaoHandlers['wadv:my_wa'],
    'wadv:join': WaDivulgacaoHandlers['wadv:join'],
    'wadv:join:auto:on': WaDivulgacaoHandlers['wadv:join:auto:on'],
    'wadv:join:auto:off': WaDivulgacaoHandlers['wadv:join:auto:off'],
    'wadv:join:manual': WaDivulgacaoHandlers['wadv:join:manual'],
    'wadv:join:cancel': WaDivulgacaoHandlers['wadv:join:cancel'],
    'wadv:groups': WaDivulgacaoHandlers['wadv:groups'],
    'wadv:groups:list': WaDivulgacaoHandlers['wadv:groups:list'],
    'wadv:groups:sync': WaDivulgacaoHandlers['wadv:groups:sync'],
    'wadv:session:reconnect': WaDivulgacaoHandlers['wadv:session:reconnect'],
    'wadv:settings': WaDivulgacaoHandlers['wadv:settings'],
    'wadv:settings:auto:on': WaDivulgacaoHandlers['wadv:settings:auto:on'],
    'wadv:settings:auto:off': WaDivulgacaoHandlers['wadv:settings:auto:off'],
    'wadv:settings:delay:*': WaDivulgacaoHandlers['wadv:settings:delay:*'],
    'wadv:settings:mode:*': WaDivulgacaoHandlers['wadv:settings:mode:*'],
    'wadv:settings:maxgroups:*': WaDivulgacaoHandlers['wadv:settings:maxgroups:*'],
    'wadv:settings:joinrate:*': WaDivulgacaoHandlers['wadv:settings:joinrate:*'],
    'wadv:settings:autopost:on': WaDivulgacaoHandlers['wadv:settings:autopost:on'],
    'wadv:settings:autopost:off': WaDivulgacaoHandlers['wadv:settings:autopost:off'],
    'wadv:settings:noop': WaDivulgacaoHandlers['wadv:settings:noop'],
    'wadv:resume:wizard': WaDivulgacaoHandlers['wadv:resume:wizard'],
    'wadv:resume:discard': WaDivulgacaoHandlers['wadv:resume:discard'],
    'wadv:tour:connect': WaDivulgacaoHandlers['wadv:tour:connect'],
    'wadv:tour:autojoin': WaDivulgacaoHandlers['wadv:tour:autojoin'],
    'wadv:tour:test': WaDivulgacaoHandlers['wadv:tour:test'],
    'wadv:tour:test:go': WaDivulgacaoHandlers['wadv:tour:test:go'],
    'wadv:tpl:*': WaDivulgacaoHandlers['wadv:tpl:*'],
    'wadv:var:hub': WaDivulgacaoHandlers['wadv:var:hub'],
    'wadv:var:back_content': WaDivulgacaoHandlers['wadv:var:back_content'],
    'wadv:var:pick:*': WaDivulgacaoHandlers['wadv:var:pick:*'],
    'wadv:var:edit:*': WaDivulgacaoHandlers['wadv:var:edit:*'],
    'wadv:var:clear:*': WaDivulgacaoHandlers['wadv:var:clear:*'],
    'wadv:var:save:*': WaDivulgacaoHandlers['wadv:var:save:*'],
    'wadv:var:rotate': WaDivulgacaoHandlers['wadv:var:rotate'],
    'wadv:var:rotate_start': WaDivulgacaoHandlers['wadv:var:rotate_start'],
    'wadv:cancel': WaDivulgacaoHandlers['wadv:cancel'],
    
    // Noop
    'noop': NoopHandlers['noop'],
    'noop:*': NoopHandlers['noop:*'],
    
    // Dev
    'dev:*': DevHandlers['dev:*']
};

// Mapeamento de callbacks antigos para novos (compatibilidade)
const LegacyMapping = {
    'buscar_btn': 'search:open',
    'flash_sales': 'flash:sales',
    'minha_conta': 'menu:minha_conta',
    'meus_favoritos': 'user:favoritos',
    'assinar_premium': 'subscription:view',
    'minha_assinatura': 'subscription:view',
    'help_btn': 'help:open',
    'orders': 'order:list',
    'rastrear_btn': 'order:track',
    'reenviar_btn': 'order:resend',
    'cupom_btn': 'user:cupom',
    'meu_afiliado': 'user:afiliado',
    'carteira': 'user:wallet',
    'minha_carteira': 'user:wallet',
    'compartilhar_btn': 'user:indicar',
    'minhas_avaliacoes': 'user:avaliacoes',
    'dev:withdraw': 'user:withdraw',
    'home': 'menu:home',
    'cat': 'catalog:view',
    'cart': 'cart:view',
    'clr': 'cart:clear',
    'checkout': 'checkout:start',
};

module.exports = {
    AllHandlers,
    UserHandlers: AllHandlers,
    LegacyMapping,
    UX
};
