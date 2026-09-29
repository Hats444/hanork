'use strict';

const AffiliateCore = require('../../../modules/affiliate/AffiliateCore');
const AffiliatePanels = require('../../../modules/affiliate/AffiliatePanels');
const UserAccountCore = require('../../../modules/user/UserAccountCore');
const UserAccountPanels = require('../../../modules/user/UserAccountPanels');
const CustomerSubscriptionService = require('../../../modules/subscription/CustomerSubscriptionService');
const UserEmailService = require('../../../services/UserEmailService');

function registerAccountCommands(bot, deps) {
    const {
        prisma,
        bot: telegramBot,
        Msg,
        Markup,
        replyWithMenuPhoto,
        dbRaw,
        resgateTentativas,
        loadProducts,
        groupGuard,
        botSession,
        campanhaEmailMode,
        requirePrivate,
        cartKey,
        Cart,
        cuponsAplicados,
        couponAttemptLimiter,
        hanorkRouterNative,
        stateManager,
    } = deps;

    async function openSubscriptionPanel(ctx) {
        const { sendWaDivulgacaoHome, isWaDivulgacaoEnabled } = require('../../../modules/wa-divulgacao/handlers/waDivulgacaoUiHandlers');
        if (isWaDivulgacaoEnabled()) {
            return sendWaDivulgacaoHome(ctx);
        }

        const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        if (!user) return replyWithMenuPhoto(ctx, '❌ Inicie o bot com /start');

        const sub = CustomerSubscriptionService.findActive(user.id);
        if (sub) {
            return replyWithMenuPhoto(
                ctx,
                CustomerSubscriptionService.formatActivePanel(sub),
                UserAccountPanels.subscriptionActiveKeyboard(sub)
            );
        }

        const products = CustomerSubscriptionService.listSubscriptionProducts();
        const product = products[0] || null;
        return replyWithMenuPhoto(
            ctx,
            CustomerSubscriptionService.formatInactivePanel(products),
            UserAccountPanels.subscriptionInactiveKeyboard(product)
        );
    }

    async function openAffiliatePanel(ctx) {
        const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        if (!user) return replyWithMenuPhoto(ctx, '❌ Faça /start primeiro.');
        const aff = await AffiliateCore.ensureAffiliate(user.id, ctx.from.id);
        const botInfo = telegramBot.botInfo || (await telegramBot.telegram.getMe());
        const txt = AffiliatePanels.buildAffiliatePanelText(aff, botInfo.username);
        await replyWithMenuPhoto(ctx, txt, AffiliatePanels.affiliatePanelKeyboard(true));
    }

    bot.command(['carteira', 'wallet'], async (ctx) => {
        const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        if (!user) return replyWithMenuPhoto(ctx, '❌ Faça /start primeiro.');
        const UserWalletService = require('../../../services/UserWalletService');
        const { buildWalletPanelText, walletPanelKeyboard } = require('../../../modules/user/WalletPanels');
        const balance = UserWalletService.getBalance(user.id);
        const ledger = UserWalletService.listRecentLedger(user.id, 8);
        await replyWithMenuPhoto(ctx, buildWalletPanelText(user, balance, ledger), walletPanelKeyboard());
    });

    bot.command('saldo', async (ctx) => {
        const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        if (!user) return replyWithMenuPhoto(ctx, '❌ Faça /start primeiro.');
        const aff = await AffiliateCore.ensureAffiliate(user.id, ctx.from.id);
        const botInfo = telegramBot.botInfo || (await telegramBot.telegram.getMe());
        await replyWithMenuPhoto(
            ctx,
            AffiliatePanels.buildSaldoText(aff, botInfo.username),
            AffiliatePanels.saldoKeyboard()
        );
    });

    bot.command('meusdados', async (ctx) => {
        const summary = await UserAccountCore.getAccountSummary(ctx.from.id);
        if (!summary) return replyWithMenuPhoto(ctx, '❌ Faça /start primeiro.');
        await replyWithMenuPhoto(
            ctx,
            UserAccountPanels.buildMeusDadosText(summary),
            UserAccountPanels.meusDadosKeyboard(!!summary.subscription)
        );
    });

    bot.command('rendimentos', async (ctx) => {
        const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        if (!user) return replyWithMenuPhoto(ctx, '❌ Faça /start primeiro.');
        const aff = await AffiliateCore.ensureAffiliate(user.id, ctx.from.id);
        const earnings = AffiliateCore.affiliateEarnings(aff);
        const txt = AffiliatePanels.buildRendimentosText(aff, user.id);
        await replyWithMenuPhoto(ctx, txt, AffiliatePanels.rendimentosKeyboard(user.id, earnings));
    });

    bot.command('pontos', async (ctx) => {
        const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        if (!user) return replyWithMenuPhoto(ctx, '❌ Você precisa iniciar o bot primeiro com /start');

        const loyalty = await prisma.loyalty.getOrCreate(user.id);

        if (loyalty.points < 100) {
            return replyWithMenuPhoto(
                ctx,
                `❌ <b>Pontos insuficientes</b>\n\n` +
                    `Você tem ${loyalty.points} pontos.\n` +
                    `Mínimo para resgatar: 100 pontos\n\n` +
                    `💡 Continue comprando para acumular mais pontos!`,
                Markup.inlineKeyboard([[{ text: '🛍️ Ver Produtos', callback_data: 'cat' }]])
            );
        }

        const pontos = loyalty.points;
        let desconto = 5;
        if (pontos >= 1000) desconto = 20;
        else if (pontos >= 500) desconto = 15;
        else if (pontos >= 200) desconto = 10;

        const cupomCode = `FIDELIDADE${ctx.from.id}`;
        const db_ = dbRaw();

        try {
            const deducted = await prisma.loyalty.deductPoints(user.id, pontos, `Resgate de cupom ${cupomCode}`, null);
            if (!deducted) return replyWithMenuPhoto(ctx, '❌ Erro ao descontar pontos. Tente novamente.');

            db_.prepare('DELETE FROM coupons WHERE code=?').run(cupomCode);
            db_.prepare(
                `INSERT OR REPLACE INTO coupons (code, type, value, max_uses, used, active, expires_at) VALUES (?,?,?,1,0,1,datetime('now','+7 days'))`
            ).run(cupomCode, 'percent', desconto);

            resgateTentativas.set(ctx.from.id, Date.now());

            await replyWithMenuPhoto(
                ctx,
                `🎉 <b>CUPOM GERADO COM SUCESSO!</b>\n\n` +
                    `🏷️ Código: <code>${cupomCode}</code>\n` +
                    `💰 Desconto: ${desconto}% OFF\n` +
                    `📊 Pontos usados: ${pontos}\n` +
                    `⏳ Válido por: 7 dias\n\n` +
                    `⚠️ <b>Atenção:</b> Este cupom só pode ser usado 1 vez!\n\n` +
                    `🛒 Use no checkout para aplicar o desconto automático!`,
                Markup.inlineKeyboard([[{ text: '🛍️ Ver Produtos', callback_data: 'cat' }]])
            );
        } catch (e) {
            deps.logger.error('resgatar:', e.message);
            await replyWithMenuPhoto(ctx, '❌ Erro ao gerar cupom. Tente novamente.');
        }
    });

    bot.command('assinatura', openSubscriptionPanel);
    if (hanorkRouterNative) hanorkRouterNative.openSubscription = openSubscriptionPanel;

    bot.command('cashback', async (ctx) => {
        const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        if (!user) return replyWithMenuPhoto(ctx, '❌ Inicie o bot com /start');

        const available = Number(await prisma.cashback.getAvailable(user.id)) || 0;
        const pending = Number(await prisma.cashback.getPending(user.id)) || 0;

        await replyWithMenuPhoto(
            ctx,
            `💸 <b>CASHBACK</b>\n\n` +
                `💰 Disponível para usar: R$ ${available.toFixed(2)}\n` +
                `⏳ Pendente (libera em 7 dias): R$ ${pending.toFixed(2)}\n\n` +
                `ℹ️ O cashback é liberado 7 dias após a compra.\n` +
                `Use automaticamente no checkout!`
        );
    });

    bot.command('afiliado', openAffiliatePanel);
    if (hanorkRouterNative) hanorkRouterNative.openAffiliate = openAffiliatePanel;

    bot.command('favoritos', async (ctx) => {
        const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        if (!user) return replyWithMenuPhoto(ctx, '❌ Faça /start primeiro.');
        const favIds = await prisma.favorite.findByUser(user.id);
        if (!favIds.length) {
            return replyWithMenuPhoto(
                ctx,
                '❤️ Você não tem favoritos ainda.\n\nAdicione produtos favoritos tocando em ❤️ na página do produto.',
                Markup.inlineKeyboard([[{ text: '🛍️ Ver Catálogo', callback_data: 'cat' }]])
            );
        }
        const prods = await loadProducts();
        const favProds = favIds.map((id) => prods.find((p) => p.id === id)).filter(Boolean);
        const rows = favProds.map((p) => [
            { text: `${p.name} — R$ ${Number(p.price).toFixed(2)}`, callback_data: `p_${p.id}` },
        ]);
        rows.push([{ text: '🏠 Menu', callback_data: 'home' }]);
        await replyWithMenuPhoto(ctx, `<b>❤️ Seus Favoritos</b> (${favProds.length})`, Markup.inlineKeyboard(rows));
    });

    bot.command('email', async (ctx) => {
        if (groupGuard.isGroupChat(ctx)) {
            return groupGuard.requirePrivate(ctx, telegramBot, {
                body: 'Cadastre seu e-mail (Gmail) em conversa privada para receber produtos e ofertas.',
            });
        }
        const cleared = await botSession.enterUserFlow(ctx, 'campanhaEmail');
        await UserEmailService.startRegistration(ctx, campanhaEmailMode, cleared);
    });

    bot.command('gmail', async (ctx) => {
        if (groupGuard.isGroupChat(ctx)) {
            return groupGuard.requirePrivate(ctx, telegramBot, {
                body: 'Cadastre seu Gmail em conversa privada com o bot (/email).',
            });
        }
        const cleared = await botSession.enterUserFlow(ctx, 'campanhaEmail');
        await UserEmailService.startRegistration(ctx, campanhaEmailMode, cleared);
    });

    bot.command('cupom', async (ctx) => {
        if (!(await requirePrivate(ctx))) return;
        const uid = ctx.from?.id;
        const cupLim = couponAttemptLimiter.check(uid);
        if (!cupLim.allowed) {
            return Msg.reply(ctx, `⏳ Muitas tentativas de cupom. Aguarde ${cupLim.retryAfter}s.`);
        }
        const parts = ctx.message.text.trim().split(/\s+/);
        const code = (parts[1] || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        if (!code) {
            return Msg.reply(
                ctx,
                '🏷️ <b>Cupom de desconto</b>\n\nUse: <code>/cupom CODIGO</code>\n\nExemplo: <code>/cupom BEM10</code>',
                { parse_mode: 'HTML' }
            );
        }
        const db = dbRaw();
        const cupom = db.prepare('SELECT * FROM coupons WHERE code=?').get(code);
        if (!cupom || !cupom.active) {
            couponAttemptLimiter.recordFail(uid);
            return Msg.reply(ctx, '❌ Cupom inválido ou inativo.');
        }
        if (cupom.expires_at && new Date(cupom.expires_at) < new Date()) {
            couponAttemptLimiter.recordFail(uid);
            return Msg.reply(ctx, '❌ Este cupom já expirou.');
        }
        if (cupom.max_uses > 0 && cupom.used >= cupom.max_uses) {
            couponAttemptLimiter.recordFail(uid);
            return Msg.reply(ctx, '❌ Este cupom atingiu o limite de usos.');
        }
        const items = await Cart.items(cartKey(ctx));
        let total;
        let smmCupomFlow = false;
        if (!items?.length) {
            let smmTotal = null;
            try {
                const { isSmmEnabled } = require('../../../modules/smm/smmEnabled');
                const { readConfirmWizard } = require('../../../modules/smm/handlers/smmWizardHandler');
                const CatalogService = require('../../../modules/smm/services/catalogService');
                if (isSmmEnabled() && stateManager) {
                    const w = await readConfirmWizard(stateManager, ctx.from?.id);
                    if (w) {
                        const q = CatalogService.quote(w.serviceId, w.quantity);
                        smmTotal = q?.sale_total;
                    }
                }
            } catch {
                /* SMM opcional */
            }
            if (smmTotal == null) {
                return Msg.reply(
                    ctx,
                    '🛒 Seu carrinho está vazio.\n\nAdicione produtos ou abra /smm e escolha um serviço antes de aplicar cupom.',
                    Markup.inlineKeyboard([
                        [{ text: '🛍️ Catálogo', callback_data: 'cat' }],
                        [{ text: '📱 Serviços', callback_data: 'smm:home' }],
                    ])
                );
            }
            total = smmTotal;
            smmCupomFlow = true;
        } else {
            total = await Cart.total(cartKey(ctx));
        }
        if (cupom.min_total > 0 && total < cupom.min_total) {
            return Msg.reply(ctx, `❌ Pedido mínimo para este cupom: R$ ${Number(cupom.min_total).toFixed(2)}`);
        }
        const discount =
            cupom.type === 'percent' ? total * (Number(cupom.value) / 100) : Number(cupom.value);
        const finalTotal = Math.max(0, total - discount);
        couponAttemptLimiter.recordSuccess(uid);
        await cuponsAplicados.set(cartKey(ctx), { code, discount, finalTotal, coupon: cupom });
        const finishHint = smmCupomFlow
            ? '<i>Toque em «Continuar para pagamento» no resumo do pedido SMM.</i>'
            : '<i>Finalize com /checkout ou pelo botão Finalizar.</i>';
        const finishBtn = smmCupomFlow
            ? [{ text: '📱 Serviços SMM', callback_data: 'smm:home' }]
            : [{ text: '💳 Finalizar', callback_data: 'checkout' }];
        await Msg.reply(
            ctx,
            `✅ <b>Cupom aplicado!</b>\n\n` +
                `🏷️ <code>${code}</code>\n` +
                `💰 Desconto: R$ ${discount.toFixed(2)}\n` +
                `🛒 Total com desconto: <b>R$ ${finalTotal.toFixed(2)}</b>\n\n` +
                finishHint,
            Markup.inlineKeyboard([finishBtn])
        );
    });

    return { openSubscriptionPanel, openAffiliatePanel };
}

module.exports = { registerAccountCommands };
