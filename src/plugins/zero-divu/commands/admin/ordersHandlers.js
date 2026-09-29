'use strict';

const { denySilent, denyCbSilent } = require('../../../utils/silencedAccess');

const { kb2, normalizeReplyMarkup } = require('../../menus/twoColKeyboard');
const destinationsPanel = require('../../admin/broadcastDestinations');
const {
    entrarNeedsBridge,
    fullDivulgacaoDeps,
    startFullDivulgacaoBackground,
    sendProgressPanel,
    updateAdminPanelMessage,
} = require('./shared');
const { pickAdminDeps } = require('./deps');


/** Pedidos, financeiro, flash, export — M4 */
function registerOrdersHandlers(bot, deps) {
    const d = pickAdminDeps(deps);
    const {
        prisma, dbRaw, Markup, isAdmin, ADMIN_HTML, Msg, Menu, logger,
        antiSpam, backup, broadcastMode, addProductMode, adminMsgTarget,
        editProductMode, giveawayMode, getMaintenanceMode, setMaintenanceMode,
        botSession, appendSessionDiscardedNote, getAutoBroadcastEnabled, setAutoBroadcastEnabled,
        getAutoBroadcastLastSent, getAutoBroadcastCount, AUTO_BROADCAST_INTERVAL, formatBroadcastInterval,
        getAutoBroadcastLastSummary, runAutoBroadcastNow, runBridgePromoNow, runBridgePromoAfterBot,
        emailService, loadProducts, executeBroadcast, executeFullBroadcast, broadcastService,
        sendAdminPanelWithPhoto, editAdminPanel, invalidateProductCache, invalidateBotUsername, formatTimer,
        carrinhos, UserService, AuditService, sendMainMenu, deliverProducts, confirmarSaldoReservado,
        showUsers, activeChats, openTicketChat, closeTicketChat, ticketCloseKeyboard,
        buildGiveawaysPanel, groupSettings, groupService, joinChatAwaiting,
    } = d;

    bot.action('a_users', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        try { await showUsers(ctx, 0); }
        catch (e) {
            logger.error('a_users error:', e.message);
            await Msg.replaceMenu(ctx, '❌ Erro ao carregar usuários.', kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
        }
    });

    bot.action(/^a_users_p_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const page = parseInt(ctx.match[1]);
        try { await showUsers(ctx, page); }
        catch (e) {
            logger.error('a_users_p error:', e.message);
            await Msg.replaceMenu(ctx, '❌ Erro.', kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
        }
    });


    // =============================================================================
    // ADMIN: PEDIDOS COM DETALHES E ENTREGA MANUAL
    // =============================================================================
    bot.action('a_orders', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const db = dbRaw();
        const pending = db.prepare("SELECT o.*, u.telegram_id as uid FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.status IN ('WAITING_PAYMENT','PAID') ORDER BY o.created_at DESC LIMIT 15").all();
        if (!pending.length) {
            const emptyTxt = `${ADMIN_HTML.header('Pedidos')}\n\n${ADMIN_HTML.green('✅ Sem pedidos pendentes')}`;
            return editAdminPanel(ctx, emptyTxt, kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
        }
        let list = '';
        pending.forEach(o => {
            const status = o.status === 'PAID' ? ADMIN_HTML.green('✅ Pago') : ADMIN_HTML.yellow('⏳ Aguardando');
            list += `${status} <b>#${o.id.slice(-8)}</b>\n├─ 👤 <code>${o.uid || '?'}</code>\n└─ 💰 R$ ${o.total.toFixed(2)}\n\n`;
        });
        const txt = `${ADMIN_HTML.header('Pedidos Pendentes')}\n${ADMIN_HTML.small(`${pending.length} itens`)}\n\n${list}`;
        const btns = pending.slice(0, 8).map(o => [{ text: `📦 Entregar #${o.id.slice(-8)}`, callback_data: `adm_deliver_${o.id}` }]);
        btns.push([{ text: '🔙 Admin', callback_data: 'a_menu' }]);
        await editAdminPanel(ctx, txt, kb2(Markup, btns));
    });

    // Entrega manual pelo admin — confirmação obrigatória se ainda aguardando pagamento
    bot.action(/^adm_deliver_(?!confirm_)(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const oid = ctx.match[1];
        const order = await prisma.order.findUnique({ where: { id: oid } });
        if (!order) return ctx.answerCbQuery('Pedido não encontrado.');
        if (order.status === 'DELIVERED') return ctx.answerCbQuery('Já entregue.');
        if (order.status === 'FAILED' || order.status === 'CANCELLED') {
            return ctx.answerCbQuery('Pedido cancelado.', { show_alert: true });
        }
        const user = await prisma.user.findUnique({ where: { id: order.user_id } });
        if (!user) return ctx.answerCbQuery('Usuário não encontrado.');

        if (order.status === 'WAITING_PAYMENT') {
            await ctx.answerCbQuery();
            const chatId = parseInt(user.telegram_id, 10);
            const confirmTxt =
                `${ADMIN_HTML.header('Confirmar entrega manual')}\n\n` +
                `${ADMIN_HTML.yellow('⚠️ Marcar como pago sem Mercado Pago?')}\n\n` +
                `🔑 Pedido: <code>#${oid.slice(-8)}</code>\n` +
                `👤 Cliente: <code>${chatId}</code>\n` +
                `💰 Valor: R$ ${Number(order.total || 0).toFixed(2)}`;
            return editAdminPanel(ctx, confirmTxt, kb2(Markup, [
                [{ text: '✅ Sim, marcar pago e entregar', callback_data: `adm_deliver_confirm_${oid}` }],
                [{ text: '❌ Cancelar', callback_data: 'a_orders' }],
            ]));
        }

        await executeAdminDeliver(ctx, { oid, order, user, markPaid: false });
    });

    bot.action(/^adm_deliver_confirm_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const oid = ctx.match[1];
        const order = await prisma.order.findUnique({ where: { id: oid } });
        if (!order) return ctx.answerCbQuery('Pedido não encontrado.');
        if (order.status === 'DELIVERED') return ctx.answerCbQuery('Já entregue.');
        if (order.status !== 'WAITING_PAYMENT') {
            return ctx.answerCbQuery('Status alterado — atualize a lista.', { show_alert: true });
        }
        const user = await prisma.user.findUnique({ where: { id: order.user_id } });
        if (!user) return ctx.answerCbQuery('Usuário não encontrado.');
        try {
            await executeAdminDeliver(ctx, { oid, order, user, markPaid: true });
        } catch (e) {
            await ctx.answerCbQuery('❌ Erro: ' + e.message);
        }
    });

    async function executeAdminDeliver(ctx, { oid, order, user, markPaid }) {
        const chatId = parseInt(user.telegram_id, 10);
        const SafeWebhookHandler = require('../../../modules/payment/SafeWebhookHandler');
        const items = await SafeWebhookHandler.resolveDeliveryItems(oid);
        if (!items.length) {
            await ctx.answerCbQuery('❌ Pedido sem itens para entrega. Verifique order_items ou pending.', { show_alert: true });
            return;
        }
        const SafeDeliveryService = require('../../../modules/delivery/SafeDeliveryService');
        if (markPaid && order.status === 'WAITING_PAYMENT') {
            await prisma.order.update({
                where: { id: oid },
                data: {
                    status: 'PAID',
                    payment_method: 'admin_manual',
                    paid_at: new Date().toISOString(),
                },
            });
            const adminUser = await UserService.findByTelegramId(ctx.from.id);
            await AuditService.log(
                adminUser?.id,
                ctx.from.id,
                'admin_manual_delivery',
                'order',
                oid,
                { status: 'WAITING_PAYMENT', total: order.total },
                { status: 'PAID', payment_method: 'admin_manual', customer_telegram_id: user.telegram_id }
            );
            logger.warn(`[ADMIN] admin_manual_delivery order=${oid} admin=${ctx.from.id} customer=${user.telegram_id}`);
        }
        const result = await SafeDeliveryService.deliverSafe(ctx.telegram, chatId, items, oid, order.user_id);
        if (!result.delivered && result.reason !== 'already_delivered') {
            await ctx.answerCbQuery('❌ Entrega não concluída: ' + (result.reason || 'erro'), { show_alert: true });
            return;
        }
        await confirmarSaldoReservado(chatId, order.user_id);
        await ctx.answerCbQuery('✅ Entregue!');
        const okTxt =
            `${ADMIN_HTML.header('Entrega Confirmada')}\n\n` +
            `${ADMIN_HTML.green(`✅ Pedido #${oid.slice(-8)}`)}\n` +
            `Entregue para: <code>${chatId}</code>` +
            (markPaid ? `\n${ADMIN_HTML.yellow('Marcado como pago (admin_manual)')}` : '');
        await editAdminPanel(ctx, okTxt, kb2(Markup, [[{ text: '📋 Pedidos', callback_data: 'a_orders' }], [{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
    }


    // =============================================================================
    // ADMIN: FINANCEIRO
    // =============================================================================
    bot.action('a_finance', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const summary = await prisma.finance.getCashFlowSummary('today');
        const week = await prisma.finance.getCashFlowSummary('week');
        const month = await prisma.finance.getCashFlowSummary('month');
        const txt =
            `${ADMIN_HTML.header('Financeiro')}\n\n` +
            `${ADMIN_HTML.sub('📊 Hoje:')}\n` +
            `├─ 💵 Entradas: ${ADMIN_HTML.green(`R$ ${summary.income.toFixed(2)}`)}\n` +
            `├─ 💸 Saídas: ${ADMIN_HTML.red(`R$ ${summary.expense.toFixed(2)}`)}\n` +
            `└─ 📈 Saldo: ${summary.balance >= 0 ? ADMIN_HTML.green(`R$ ${summary.balance.toFixed(2)}`) : ADMIN_HTML.red(`R$ ${summary.balance.toFixed(2)}`)}\n\n` +
            `${ADMIN_HTML.sub('📊 Últimos 7 Dias:')}\n` +
            `├─ 💵 Entradas: ${ADMIN_HTML.green(`R$ ${week.income.toFixed(2)}`)}\n` +
            `└─ 📈 Saldo: ${week.balance >= 0 ? ADMIN_HTML.green(`R$ ${week.balance.toFixed(2)}`) : ADMIN_HTML.red(`R$ ${week.balance.toFixed(2)}`)}\n\n` +
            `${ADMIN_HTML.sub('📊 Mês:')}\n` +
            `├─ 💵 Entradas: ${ADMIN_HTML.green(`R$ ${month.income.toFixed(2)}`)}\n` +
            `└─ 📈 Saldo: ${month.balance >= 0 ? ADMIN_HTML.green(`R$ ${month.balance.toFixed(2)}`) : ADMIN_HTML.red(`R$ ${month.balance.toFixed(2)}`)}`;
        await editAdminPanel(ctx, txt, kb2(Markup, [
            [{ text: '📊 Vendas Hoje', callback_data: 'fin_daily' }, { text: '📈 Vendas Mês', callback_data: 'fin_monthly' }],
            [{ text: '🔙 Admin', callback_data: 'a_menu' }]
        ]));
    });

    bot.action('fin_daily', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const db = dbRaw();
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const row = db.prepare(
            "SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM orders WHERE status IN ('PAID','DELIVERED') AND created_at >= ?"
        ).get(start.toISOString());
        const txt =
            `${ADMIN_HTML.header('Vendas — Hoje')}\n\n` +
            `💰 ${ADMIN_HTML.green(`R$ ${Number(row.t || 0).toFixed(2)}`)}\n` +
            `🧾 Pedidos pagos/entregues: <b>${row.c || 0}</b>`;
        await editAdminPanel(ctx, txt, kb2(Markup, [
            [{ text: '🔙 Financeiro', callback_data: 'a_finance' }],
            [{ text: '🔙 Admin', callback_data: 'a_menu' }],
        ]));
    });

    bot.action('fin_monthly', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const db = dbRaw();
        const inicioMes = new Date();
        inicioMes.setDate(1);
        inicioMes.setHours(0, 0, 0, 0);
        const row = db.prepare(
            "SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM orders WHERE status IN ('PAID','DELIVERED') AND created_at >= ?"
        ).get(inicioMes.toISOString());
        const ticket = row.c > 0 ? row.t / row.c : 0;
        const txt =
            `${ADMIN_HTML.header('Vendas — Mês')}\n\n` +
            `💰 ${ADMIN_HTML.green(`R$ ${Number(row.t || 0).toFixed(2)}`)}\n` +
            `🧾 Pedidos: <b>${row.c || 0}</b>\n` +
            `🎯 Ticket médio: R$ ${ticket.toFixed(2)}`;
        await editAdminPanel(ctx, txt, kb2(Markup, [
            [{ text: '🔙 Financeiro', callback_data: 'a_finance' }],
            [{ text: '🔙 Admin', callback_data: 'a_menu' }],
        ]));
    });


    // =============================================================================
    // ADMIN: FLASH SALES (LISTAR OFERTAS)
    // =============================================================================
    bot.action('a_flash', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        try {
            const sales = prisma.flashSale ? prisma.flashSale.findAllActive() : [];
            logger.info(`Admin ${ctx.from.id} acessou flash sales: ${sales.length} ativas`);
            if (!sales || sales.length === 0) {
                const emptyTxt =
                    `${ADMIN_HTML.header('Flash Sales')}\n\n` +
                    `${ADMIN_HTML.yellow('Nenhuma oferta ativa')}\n\n` +
                    `${ADMIN_HTML.sub('Para criar:')}\n` +
                    `<code>/flashsale ID_PRODUTO PRECO HORAS</code>\n\n` +
                    `${ADMIN_HTML.small('Ex: /flashsale 1 97.00 24')}`;
                return editAdminPanel(ctx, emptyTxt, kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
            }
            let list = '';
            for (const s of sales) {
                const prod = await prisma.product.findUnique({ where: { id: s.product_id } });
                const now = new Date();
                const end = new Date(s.ends_at);
                const hoursLeft = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60)));
                list += `${ADMIN_HTML.red('🔥')} <b>${s.product_name || prod?.name || 'Produto'}</b>\n`;
                list += `├─ 💰 ${ADMIN_HTML.green(`R$ ${s.sale_price?.toFixed(2) || '?'}`)} | ⏰ ${hoursLeft}h\n`;
                list += `└─ 📊 ${s.sold_count || 0}/${s.stock_limit || '∞'} vendidos\n\n`;
            }
            const txt = `${ADMIN_HTML.header(`Flash Sales (${sales.length})`)}\n\n${list}`;
            const btns = sales.slice(0, 5).map(s => [{ text: `❌ Cancelar #${s.id}`, callback_data: `fs_cancel_${s.id}` }]);
            btns.push([{ text: '🔙 Admin', callback_data: 'a_menu' }]);
            await editAdminPanel(ctx, txt, kb2(Markup, btns));
        } catch (e) {
            logger.error('Erro em a_flash:', e.message);
            await Msg.reply(ctx, '❌ Erro: ' + e.message);
        }
    });

    bot.action(/^fs_cancel_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        try {
            const id = parseInt(ctx.match[1]);
            if (prisma.flashSale) {
                await prisma.flashSale.delete(id);
            }
            await ctx.answerCbQuery('❌ Flash sale cancelada');
            // Recarregar lista
            const sales = prisma.flashSale ? prisma.flashSale.findAllActive() : [];
            if (!sales || sales.length === 0) {
                return Msg.edit(ctx,
                    '🔥 *FLASH SALES*\n\nNenhuma oferta ativa.',
                    kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]])
                );
            }
            let txt = `🔥 <b>FLASH SALES ATIVAS (${sales.length})</b>\n\n`;
            sales.forEach(s => {
                txt += `• <b>${s.product_name || 'Produto'}</b>\n`;
                txt += `  💰 R$ ${s.sale_price?.toFixed(2) || '?'}\n\n`;
            });
            const btns = sales.slice(0, 5).map(s => [{ text: `❌ Cancelar #${s.id}`, callback_data: `fs_cancel_${s.id}` }]);
            btns.push([{ text: '🔙 Admin', callback_data: 'a_menu' }]);
            await Msg.edit(ctx, txt, kb2(Markup, btns));
        } catch (e) {
            logger.error('Erro ao cancelar flash sale:', e.message);
            await ctx.answerCbQuery('❌ Erro ao cancelar');
        }
    });


    bot.action('a_exportar', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery('📥 Gerando CSV...');
        try {
            const db = dbRaw();
            const orders = db.prepare(`
                SELECT o.id, u.telegram_id, u.first_name, u.username, o.status,
                       o.total, o.created_at, o.payment_method,
                       GROUP_CONCAT(p.name, ' | ') as produtos
                FROM orders o
                LEFT JOIN users u ON u.id = o.user_id
                LEFT JOIN order_items oi ON oi.order_id = o.id
                LEFT JOIN products p ON p.id = oi.product_id
                GROUP BY o.id
                ORDER BY o.created_at DESC LIMIT 1000
            `).all();
            if (!orders.length) return Msg.reply(ctx, 'Nenhum pedido encontrado.');
            const header = 'ID,Telegram ID,Nome,Username,Status,Total,Data,Pagamento,Produtos\n';
            const rows = orders.map(o =>
                [o.id.slice(-8), o.telegram_id || '', (o.first_name || '').replace(/,/g, ' '), (o.username || '').replace(/,/g, ''), o.status, Number(o.total).toFixed(2), o.created_at?.slice(0, 10) || '', o.payment_method || '', (o.produtos || '').replace(/,/g, ';')].join(',')
            ).join('\n');
            const buf = Buffer.from(header + rows, 'utf-8');
            await ctx.replyWithDocument({ source: buf, filename: `pedidos_${new Date().toISOString().slice(0, 10)}.csv` }, { caption: `📥 <b>${orders.length} pedidos exportados</b>`, parse_mode: 'HTML' });
        } catch (e) { await Msg.reply(ctx, '❌ Erro: ' + e.message.slice(0, 80)); }
    });


    // Admin: ver avaliações
    // Admin: ver produtos com notificação de restock pendentes
    bot.action('a_restock', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        try {
            const db = dbRaw();
            // Buscar produtos que estão em falta (stock = 0) mas têm usuários esperando
            const prodsFalta = db.prepare(`
                SELECT p.*, COUNT(rn.id) as waiting_count 
                FROM products p 
                LEFT JOIN restock_notify rn ON rn.product_id = p.id AND rn.notified = 0
                WHERE p.stock = 0 AND p.active = 1 
                GROUP BY p.id 
                HAVING waiting_count > 0 
                ORDER BY waiting_count DESC
            `).all();
            
            // Buscar todos os produtos em falta (independentemente de notificações)
            const todosFalta = db.prepare(`SELECT * FROM products WHERE stock = 0 AND active = 1 ORDER BY name`).all();
            
            if (!prodsFalta.length && !todosFalta.length) {
                return editAdminPanel(ctx, 
                    `${ADMIN_HTML.header('📦 Restock')}\n\n${ADMIN_HTML.green('✅ Nenhum produto em falta')}`, 
                    kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]])
                );
            }
            
            let txt = `${ADMIN_HTML.header('📦 Restock — Produtos em Falta')}\n\n`;
            
            if (prodsFalta.length) {
                txt += `<b>🔔 Com notificações pendentes:</b>\n\n`;
                prodsFalta.forEach(p => {
                    txt += `• <b>${p.name}</b>\n`;
                    txt += `  👥 ${p.waiting_count} esperando | 🔔 Notificações ativas\n`;
                    txt += `  <code>/restock ${p.id} QUANTIDADE</code>\n\n`;
                });
            }
            
            if (todosFalta.length > prodsFalta.length) {
                const semNotif = todosFalta.filter(t => !prodsFalta.find(p => p.id === t.id));
                if (semNotif.length) {
                    txt += `<b>📭 Sem notificações:</b>\n`;
                    semNotif.slice(0, 5).forEach(p => {
                        txt += `• ${p.name} <code>/restock ${p.id} QTD</code>\n`;
                    });
                    if (semNotif.length > 5) txt += `...e mais ${semNotif.length - 5}\n`;
                }
            }
            
            txt += `\n<b>Comandos:</b>\n<code>/restock ID QUANTIDADE</code> — Repor estoque\n<code>/addproduto</code> — Adicionar novo produto`;
            
            await editAdminPanel(ctx, txt, kb2(Markup, [
                [{ text: '🔄 Atualizar', callback_data: 'a_restock' }],
                [{ text: '🔙 Admin', callback_data: 'a_menu' }]
            ]));
        } catch (e) {
            logger.error('a_restock error:', e.message);
            await ctx.answerCbQuery('❌ Erro ao carregar');
        }
    });

    bot.command('relatorio', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const hoje = new Date();
        const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();
        const db = dbRaw();

        const totalMes = db
            .prepare(
                "SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM orders WHERE status IN ('PAID','DELIVERED') AND created_at >= ?"
            )
            .get(inicioMes);
        const totalGeral = db
            .prepare("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM orders WHERE status IN ('PAID','DELIVERED')")
            .get();
        const ticketMedio = totalGeral.c > 0 ? totalGeral.t / totalGeral.c : 0;
        const pendentes = db
            .prepare("SELECT COUNT(*) as c, COALESCE(SUM(total),0) as t FROM orders WHERE status='WAITING_PAYMENT'")
            .get();
        const topProds = db
            .prepare(
                "SELECT p.name, SUM(oi.quantity) as qtd, SUM(oi.price*oi.quantity) as receita FROM order_items oi JOIN products p ON p.id=oi.product_id JOIN orders o ON o.id=oi.order_id WHERE o.status IN ('PAID','DELIVERED') GROUP BY oi.product_id ORDER BY qtd DESC LIMIT 5"
            )
            .all();
        const revStats = await prisma.review.stats();
        const affCount = db.prepare('SELECT COUNT(*) as c FROM affiliates').get().c;

        let txt = `<b>📊 Relatório Financeiro</b>\n\n`;
        txt += `<b>📅 Este mês:</b>\n💰 R$ ${totalMes.t.toFixed(2)} (${totalMes.c} vendas)\n\n`;
        txt += `<b>📈 Total geral:</b>\n💰 R$ ${totalGeral.t.toFixed(2)} (${totalGeral.c} vendas)\n🎯 Ticket médio: R$ ${ticketMedio.toFixed(2)}\n\n`;
        txt += `<b>⏳ Pendentes:</b> ${pendentes.c} pedidos — R$ ${pendentes.t.toFixed(2)}\n\n`;
        if (topProds.length) {
            txt += `<b>🏆 Top Produtos:</b>\n`;
            topProds.forEach((p, i) => {
                txt += `${i + 1}. ${p.name} — ${p.qtd}x — R$ ${p.receita.toFixed(2)}\n`;
            });
            txt += '\n';
        }
        txt += `<b>⭐ Avaliações:</b> ${revStats.avg}/5 (${revStats.total} notas)\n`;
        txt += `<b>🤝 Afiliados:</b> ${affCount} ativos`;

        await Msg.edit(ctx, txt, Markup.inlineKeyboard([[{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
    });

    bot.command('reembolso', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const parts = ctx.message.text.split(' ');
        const oidPart = parts[1];
        if (!oidPart) {
            return Msg.reply(ctx, 'Use: `/reembolso ID_PEDIDO`\n\nUse os últimos dígitos do ID do pedido.', { parse_mode: 'HTML' });
        }
        const db = dbRaw();
        const safeOid = oidPart.replace(/[%_'"\\]/g, '').slice(0, 36);
        if (!safeOid) return Msg.reply(ctx, '❌ ID inválido.');
        const order = db
            .prepare('SELECT o.*, u.telegram_id as uid FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.id LIKE ?')
            .get('%' + safeOid);
        if (!order) return Msg.reply(ctx, '❌ Pedido não encontrado.');
        const RefundService = require('../../../services/RefundService');
        if (RefundService.isRefundedStatus(order.status)) return Msg.reply(ctx, '❌ Pedido já cancelado/reembolsado.');
        await Msg.reply(
            ctx,
            `<b>💸 Confirmar Reembolso?</b>\n\n🔑 Pedido: <code>#${order.id.slice(-8)}</code>\n👤 Cliente: <code>${order.uid || '?'}</code>\n💰 Valor: R$ ${order.total.toFixed(2)}\n📌 Status atual: ${order.status}`,
            {
                parse_mode: 'HTML',
                reply_markup: Markup.inlineKeyboard([
                    [{ text: '✅ Confirmar Reembolso', callback_data: `refund_${order.id}` }],
                    [{ text: '❌ Cancelar', callback_data: 'a_menu' }],
                ]).reply_markup,
            }
        );
    });

    bot.action(/^refund_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        const oid = ctx.match[1];
        const RefundService = require('../../../services/RefundService');
        await RefundService.processRefund(ctx, oid, { notifyTelegram: ctx.telegram });
    });

    bot.command('carrinhos', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const CartService = require('../../../modules/cart/CartService');
        const allCarts = (await CartService.getAllActive?.()) || [];
        if (!allCarts.length) return Msg.reply(ctx, '🛒 Nenhum carrinho ativo no momento.');
        let txt = `<b>🛒 Carrinhos Ativos (${allCarts.length})</b>\n\n`;
        let count = 0;
        for (const [chatId, c] of allCarts) {
            if (count++ >= 10) break;
            const items = Array.isArray(c) ? c : [];
            if (!items.length) continue;
            const total = items.reduce((s, i) => s + Number(i.price || 0) * (i.qty || 1), 0);
            txt += `👤 <code>${chatId}</code> — R$ ${total.toFixed(2)}\n`;
            txt += items.map((i) => `  • ${i.name} x${i.qty || 1}`).join('\n') + '\n\n';
        }
        await Msg.sendLongHtml(ctx, txt, Markup.inlineKeyboard([[{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
    });
}

module.exports = { registerOrdersHandlers };
