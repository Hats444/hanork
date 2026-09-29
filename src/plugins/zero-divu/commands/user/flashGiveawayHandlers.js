'use strict';

const { denySilent, denyCbSilent } = require('../../../utils/silencedAccess');

const { formatTimer, buildSaleCard } = require('../../../modules/flash/flashSaleUi');

/**
 * B3 — flash sales (cliente + broadcast) e sorteios públicos (gw_view/part).
 */
function registerFlashGiveawayHandlers(bot, deps) {
    const {
        isAdmin,
        Msg,
        Markup,
        Menu,
        prisma,
        dbRaw,
        logger,
        bot: telegramBot,
        CONFIG,
        antiSpam,
        deferBackground,
        autoBroadcastService,
        broadcastService,
        replyWithMenuPhoto,
        getProductById,
        loadProducts,
        cartKey,
        comprasPendentes,
        getAffSaldo,
        createOrder,
    } = deps;

    async function sendSaleCard(ctx, sales, idx, isNew) {
        const s = sales[idx];
        const total = sales.length;
        const txt = buildSaleCard(s, idx + 1, total);
        const rows = [];
        rows.push([{ text: `⚡ Comprar por R$ ${s.sale_price.toFixed(2)}`, callback_data: `fs_buy_${s.product_id}_${s.id}` }]);
        rows.push([{ text: '📦 Ver Produto', callback_data: `p_${s.product_id}` }]);
        if (total > 1) {
            const navRow = [];
            if (idx > 0) navRow.push({ text: `◀️ ${idx}/${total}`, callback_data: `fs_nav_${idx - 1}` });
            else navRow.push({ text: `• ${idx + 1}/${total}`, callback_data: 'noop' });
            if (idx < total - 1) navRow.push({ text: `${idx + 2}/${total} ▶️`, callback_data: `fs_nav_${idx + 1}` });
            rows.push(navRow);
        }
        rows.push([{ text: '🛍️ Catálogo', callback_data: 'cat' }, { text: '🏠 Menu', callback_data: 'home' }]);
        const kb = Markup.inlineKeyboard(rows);
        if (isNew) {
            try {
                await ctx.answerCbQuery();
            } catch {
                /* ignore */
            }
            await Msg.replaceMenu(ctx, txt, kb, s.product_photo ? { photoUrl: s.product_photo } : { useMenuPhoto: true });
        } else {
            await Msg.editCallbackPanel(ctx, txt, kb, s.product_photo ? { photoUrl: s.product_photo } : { useMenuPhoto: true });
        }
    }

    async function openFlashSalesPanel(ctx) {
        prisma.flashSale.expire();
        const sales = await Promise.resolve(prisma.flashSale.findAllActive());

        if (!isAdmin(ctx.from.id)) {
            if (!sales.length) {
                return replyWithMenuPhoto(
                    ctx,
                    '😔 <b>Nenhuma oferta ativa agora.</b>\n\n<i>Volte em breve — as promoções aparecem aqui!</i>',
                    Markup.inlineKeyboard([
                        [{ text: '🛍️ Catálogo', callback_data: 'cat' }],
                        [{ text: '🏠 Menu', callback_data: 'home' }],
                    ])
                );
            }
            return sendSaleCard(ctx, sales, 0, true);
        }

        if (!sales.length) return Msg.reply(ctx, '✅ Nenhuma flash sale ativa.');
        let txt = `<b>🔥 Flash Sales Ativas (${sales.length})</b>\n\n`;
        const rows = [];
        for (const s of sales) {
            const ms = new Date(s.ends_at) - Date.now();
            const pct = Math.round(((s.original_price - s.sale_price) / s.original_price) * 100);
            txt += `📦 <b>${s.product_name}</b> — R$ ${s.sale_price.toFixed(2)} (-${pct}%)\n⏳ ${formatTimer(ms)}${s.stock_limit > 0 ? ` | ${s.sold_count}/${s.stock_limit}` : ''}\n\n`;
            rows.push([{ text: `❌ Cancelar: ${s.product_name}`, callback_data: `fs_cancel_${s.id}` }]);
        }
        rows.push([{ text: '🔙 Admin', callback_data: 'a_menu' }]);
        await Msg.sendLongHtml(ctx, txt, Markup.inlineKeyboard(rows), { editFirst: !!ctx.callbackQuery });
    }

    async function showGiveawayCard(ctx, g) {
        const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
        const joined = user ? prisma.giveaway.isParticipant(g.id, user.id) : false;
        const parts =
            dbRaw().prepare('SELECT COUNT(*) as c FROM giveaway_participants WHERE giveaway_id=?').get(g.id)?.c || 0;
        let txt =
            `<b>🎉 ${g.name}</b>\n\n` +
            `${g.description ? `${g.description}\n\n` : ''}` +
            `🎁 Prêmio: <b>${g.prize}</b>\n` +
            `👥 Participantes: <b>${parts}</b>\n` +
            `📅 Até: ${g.end_date || '—'}\n\n` +
            (joined ? '✅ Você já está participando!' : 'Toque em <b>Participar</b> para entrar.');
        const rows = [];
        if (!joined && user) {
            rows.push([{ text: '🎫 Participar', callback_data: `gw_part_${g.id}` }]);
        } else if (!user) {
            txt += '\n\n<i>Faça /start no bot para participar.</i>';
        }
        rows.push([{ text: '🏠 Menu', callback_data: 'menu:home' }]);
        return replyWithMenuPhoto(ctx, txt, Markup.inlineKeyboard(rows));
    }

    async function openGiveawayPanel(ctx) {
        const COPY = require('../../../config/hanork-router-copy');
        const active = prisma.giveaway.findActive() || [];
        if (!active.length) {
            return replyWithMenuPhoto(
                ctx,
                COPY.giveawayIdle,
                Markup.inlineKeyboard([
                    [{ text: '📂 Catálogo', callback_data: 'cat' }],
                    [{ text: '🏠 Menu', callback_data: 'menu:home' }],
                ])
            );
        }
        if (active.length === 1) {
            return showGiveawayCard(ctx, active[0]);
        }
        const rows = active.slice(0, 10).map((g) => [{ text: `#${g.id} — ${g.name}`, callback_data: `gw_view_${g.id}` }]);
        rows.push([{ text: '🏠 Menu', callback_data: 'menu:home' }]);
        return replyWithMenuPhoto(ctx, '<b>🎉 Sorteios ativos</b>\n\nEscolha um sorteio:', Markup.inlineKeyboard(rows));
    }

    bot.command('flashsale', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const parts = ctx.message.text.split(' ');
        if (parts.length < 4) {
            return Msg.reply(
                ctx,
                'Use: `/flashsale ID PRECO HORAS [LIMITE]`\n\nEx: `/flashsale 3 19.90 2` _(sem limite)_\nEx: `/flashsale 3 19.90 2 50` _(50 unidades)_',
                { parse_mode: 'HTML' }
            );
        }
        const pid = parseInt(parts[1], 10);
        const salePrice = parseFloat(parts[2]);
        const horas = parseFloat(parts[3]);
        const stockLimit = parseInt(parts[4] || '0', 10) || 0;
        if (isNaN(pid) || isNaN(salePrice) || isNaN(horas) || !pid || salePrice <= 0 || horas <= 0) {
            return Msg.reply(ctx, '❌ Valores inválidos.');
        }
        if (horas > 720) return Msg.reply(ctx, '❌ Duração máxima: 720 horas (30 dias).');
        const prod = await prisma.product.findUnique({ where: { id: pid } });
        if (!prod) return Msg.reply(ctx, '❌ Produto não encontrado.');
        if (salePrice >= prod.price) {
            return Msg.reply(ctx, `❌ O preço promocional (R$ ${salePrice.toFixed(2)}) deve ser menor que o original (R$ ${prod.price.toFixed(2)}).`);
        }
        const endsAt = new Date(Date.now() + horas * 3600000).toISOString();
        await prisma.flashSale.create(pid, salePrice, prod.price, endsAt, stockLimit);
        logger.flashSale(prod.name, salePrice, horas);
        logger.admin(ctx.from.id, `flashsale ${prod.name} R$${salePrice} por ${horas}h`);
        const pct = Math.round(((prod.price - salePrice) / prod.price) * 100);
        const economia = (prod.price - salePrice).toFixed(2);
        const limiteTxt = stockLimit > 0 ? `\n📊 Limite: ${stockLimit} unidades` : '\n📊 Sem limite de unidades';
        await Msg.reply(
            ctx,
            `✅ <b>Flash Sale criada!</b>\n\n📦 ${prod.name}\n💸 ~<s>R$ ${prod.price.toFixed(2)}</s>~ ➜ <b>R$ ${salePrice.toFixed(2)}</b> (-${pct}%)\n✅ Economia de R$ ${economia}\n⏰ Por ${horas}h${limiteTxt}\n\n_Deseja enviar para todos os usuários?_`,
            {
                parse_mode: 'HTML',
                reply_markup: Markup.inlineKeyboard([
                    [{ text: '📢 Divulgar para todos', callback_data: `fs_broadcast_${pid}` }],
                    [{ text: '👁️ Ver Ofertas', callback_data: 'flash_sales' }],
                ]).reply_markup,
            }
        );
    });

    bot.command('flashsales', openFlashSalesPanel);

    bot.action(/^fs_broadcast_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        const pid = parseInt(ctx.match[1], 10);
        prisma.flashSale.expire();
        const sale = prisma.flashSale.findActive(pid);
        if (!sale) return ctx.answerCbQuery('⏰ Oferta expirada.');
        if (broadcastService.isRunning || autoBroadcastService.isCycleRunning()) {
            return ctx.answerCbQuery('⚠️ Já há um broadcast em andamento.');
        }
        await ctx.answerCbQuery('📢 Enviando...');
        const productName = sale.product_name || (await getProductById(pid))?.name || `#${pid}`;
        deferBackground('fs-broadcast', async () => {
            const result = await autoBroadcastService.broadcastFlashSale(pid);
            const { BroadcastService } = require('../../../services/BroadcastService');
            for (const aid of CONFIG.ID_DONO) {
                try {
                    if (!result.success) {
                        await telegramBot.telegram.sendMessage(
                            aid,
                            `❌ <b>Flash broadcast falhou</b>\n\n📦 ${productName}\n<i>${result.error || 'erro desconhecido'}</i>`,
                            { parse_mode: 'HTML' }
                        );
                        continue;
                    }
                    const summary = BroadcastService.formatFullResult(result).replace(
                        '✅ <b>Divulgação completa!</b>\n\n',
                        ''
                    );
                    await telegramBot.telegram.sendMessage(
                        aid,
                        `📢 <b>Broadcast Flash Sale finalizado!</b>\n\n📦 <b>${result.productName || productName}</b>\n\n${summary}`,
                        { parse_mode: 'HTML' }
                    );
                } catch {
                    /* ignore */
                }
            }
        });
    });

    bot.action(/^fs_nav_(\d+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        if (!antiSpam.checkCallback(ctx.chat.id, 'fs_nav')) return;
        prisma.flashSale.expire();
        const sales = await Promise.resolve(prisma.flashSale.findAllActive());
        if (!sales.length) return ctx.answerCbQuery('⏰ Todas as ofertas expiraram!', { show_alert: true });
        const idx = Math.min(parseInt(ctx.match[1], 10), sales.length - 1);
        await sendSaleCard(ctx, sales, idx, false);
    });

    bot.action(/^fs_buy_(\d+)_(\d+)$/, async (ctx) => {
        const pid = parseInt(ctx.match[1], 10);
        const saleId = parseInt(ctx.match[2], 10);
        await ctx.answerCbQuery('🛒 Processando...');
        if (!antiSpam.checkCallback(ctx.chat.id, `fs_buy_${pid}`)) return;
        const { lockCallbackKeyboard } = require('../../../utils/callbackUi');
        await lockCallbackKeyboard(ctx, '⏳ Criando pedido...');
        const { withLockOrSkip } = require('../../../infrastructure/DistributedStateManager');
        const existingFs = await comprasPendentes.get(cartKey(ctx));
        if (existingFs?.orderId) {
            const affSaldoFs = await getAffSaldo(ctx.from.id);
            return Msg.edit(
                ctx,
                `<b>🛒 Pedido #${existingFs.orderId.slice(-8)}</b>\n\n💰 R$ ${existingFs.total.toFixed(2)}\n\n<i>Pagamento em aberto</i>\n\nEscolha a forma de pagamento:`,
                Menu.pagamento(existingFs.orderId, affSaldoFs, existingFs.total)
            );
        }
        const result = await withLockOrSkip(`fs_buy:${ctx.from.id}`, 15000, async () => {
            prisma.flashSale.expire();
            const sale = prisma.flashSale.findActive(pid);
            if (!sale) return { ok: false, reason: 'expired' };
            if (sale.stock_limit > 0 && sale.sold_count >= sale.stock_limit) {
                return { ok: false, reason: 'sold_out' };
            }
            const prods = await loadProducts();
            const p = prods.find((x) => x.id === pid);
            if (!p || p.stock <= 0) return { ok: false, reason: 'unavailable' };
            const order = await createOrder(ctx.from.id.toString(), [
                { product_id: p.id, quantity: 1, price: sale.sale_price, name: p.name, file_url: p.file_url },
            ]);
            await prisma.order.update({ where: { id: order.id }, data: { status: 'WAITING_PAYMENT' } });
            const affSaldo3 = await getAffSaldo(ctx.from.id);
            const pct = Math.round(((sale.original_price - sale.sale_price) / sale.original_price) * 100);
            await comprasPendentes.set(cartKey(ctx), {
                orderId: order.id,
                userId: order.user_id,
                items: [{ product_id: p.id, quantity: 1, price: sale.sale_price, name: p.name, file_url: p.file_url }],
                total: sale.sale_price,
                externalRef: order.external_reference,
                createdAt: Date.now(),
                flashSaleId: sale.id,
                _ts: Date.now(),
            });
            return { ok: true, order, p, sale, affSaldo3, pct };
        });
        if (result === null) {
            return ctx.answerCbQuery('⏳ Aguarde, processando compra anterior…', { show_alert: true });
        }
        if (!result?.ok) {
            const msgs = {
                expired: '⏰ Oferta expirada!',
                sold_out: '😔 Unidades esgotadas nesta oferta!',
                unavailable: '❌ Produto indisponível.',
            };
            return ctx.answerCbQuery(msgs[result.reason] || '❌ Indisponível', { show_alert: true });
        }
        const { order, p, sale, affSaldo3, pct } = result;
        try {
            await Msg.edit(
                ctx,
                `🔥 <b>Oferta Relâmpago!</b>\n\n📦 <b>${p.name}</b>\n💸 ~<s>R$ ${sale.original_price.toFixed(2)}</s>~ ➜ <b>R$ ${sale.sale_price.toFixed(2)}</b> (-${pct}%)\n✅ Economia de R$ ${(sale.original_price - sale.sale_price).toFixed(2)}${affSaldo3 > 0 ? `\n\n💰 <i>Saldo afiliado: R$ ${affSaldo3.toFixed(2)}</i>` : ''}\n\nEscolha a forma de pagamento:`,
                Menu.pagamento(order.id, affSaldo3, sale.sale_price)
            );
        } catch {
            await Msg.edit(
                ctx,
                '❌ Erro ao criar pedido.',
                Markup.inlineKeyboard([
                    [{ text: '🛍️ Catálogo', callback_data: 'cat' }, { text: '🏠 Menu', callback_data: 'home' }],
                ])
            );
        }
    });

    bot.action(/^gw_view_(\d+)$/, async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        const g = await prisma.giveaway.findById(parseInt(ctx.match[1], 10));
        if (!g) return Msg.reply(ctx, 'Sorteio não encontrado ou encerrado.');
        return showGiveawayCard(ctx, g);
    });

    bot.action(/^gw_part_(\d+)$/, async (ctx) => {
        const gid = parseInt(ctx.match[1], 10);
        const g = await prisma.giveaway.findById(gid);
        if (!g) {
            return ctx.answerCbQuery('Sorteio encerrado', { show_alert: true }).catch(() => {});
        }
        const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
        if (!user) {
            await ctx.answerCbQuery().catch(() => {});
            return Msg.reply(ctx, '❌ Faça /start primeiro para participar.');
        }
        if (prisma.giveaway.isParticipant(gid, user.id)) {
            return ctx.answerCbQuery('Você já está inscrito!', { show_alert: true }).catch(() => {});
        }
        const ok = prisma.giveaway.participate(gid, user.id, 1);
        if (!ok) {
            return ctx.answerCbQuery('Não foi possível participar. Tente de novo.', { show_alert: true }).catch(() => {});
        }
        await ctx.answerCbQuery('🎉 Inscrito no sorteio!').catch(() => {});
        return showGiveawayCard(ctx, g);
    });

    return { openFlashSalesPanel, openGiveawayPanel };
}

module.exports = { registerFlashGiveawayHandlers };
