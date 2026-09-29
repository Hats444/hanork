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
const { sendHelpJson } = require('../helpJsonDelivery');


/** Painel admin, stats, produtos, manutenção — M4 */
function registerPanelHandlers(bot, deps) {
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

    bot.command('admin', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        try {
            const sessionCleared = botSession
                ? await botSession.clearForAdminNav(ctx)
                : {};
            let summary = { income: 0, expense: 0 };
            try {
                summary = await prisma.finance.getCashFlowSummary('today');
            } catch (finErr) {
                logger.warn('[admin] finance summary:', finErr.message);
            }
            const { escapeTelegramHtml } = require('../../htmlEscape');
            const nome = escapeTelegramHtml(ctx.from?.first_name || 'Admin');
            const h = new Date().getUTCHours() - 3;
            const saudacao = h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
            const mm = getMaintenanceMode();
            const { buildAdminPanelKeyboard, adminPanelPageLine } = require('../../menus/adminPanelUi');
            const { markup, safePage, totalPages } = buildAdminPanelKeyboard(0);
            const caption = appendSessionDiscardedNote(
                `${ADMIN_HTML.header('Hanork Bot v3.5 — Admin')}\n\n` +
                `${ADMIN_HTML.sub(`${saudacao}, ${nome}!`)} 👋` +
                adminPanelPageLine(safePage, totalPages) +
                `\n\n` +
                `💰 Vendas: ${ADMIN_HTML.green(`R$ ${summary.income.toFixed(2)}`)}\n` +
                `💸 Despesas: ${ADMIN_HTML.red(`R$ ${summary.expense.toFixed(2)}`)}\n\n` +
                `${mm ? ADMIN_HTML.red('⛔ MANUTENÇÃO ATIVA') : ADMIN_HTML.green('✅ BOT OPERACIONAL')}\n\n` +
                `${ADMIN_HTML.small('📖 /help ou botão 📖 Comandos')}`,
                sessionCleared
            );
            await sendAdminPanelWithPhoto(ctx, caption, markup);
        } catch (e) {
            logger.error('Erro no comando admin:', e.message);
            try {
                await Msg.reply(ctx, 
                    `❌ Erro ao abrir painel: ${e.message}\n\nTente de novo ou use /help.`,
                    { parse_mode: 'HTML' }
                );
            } catch { /* ignore */ }
        }
    });

    async function renderAdminMenuPanel(ctx, page = 0) {
        const sessionCleared = botSession ? await botSession.clearForAdminNav(ctx) : {};
        const nome = ctx.from?.first_name || 'Admin';
        const h = new Date().getUTCHours() - 3;
        const saudacao = h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
        const mm = getMaintenanceMode();
        const { buildAdminPanelKeyboard, adminPanelPageLine } = require('../../menus/adminPanelUi');
        const { markup, safePage, totalPages } = buildAdminPanelKeyboard(page);
        await sendAdminPanelWithPhoto(ctx,
            appendSessionDiscardedNote(
                `${ADMIN_HTML.header('Painel Administrativo')}\n\n` +
                `${ADMIN_HTML.sub(`${saudacao}, ${nome}!`)} 👋` +
                adminPanelPageLine(safePage, totalPages) +
                `\n\n` +
                `${mm ? ADMIN_HTML.red('⛔ MANUTENÇÃO ATIVA') : ADMIN_HTML.green('✅ BOT OPERACIONAL')}\n\n` +
                `${ADMIN_HTML.small('Botões abaixo · comandos: /help ou 📖 Comandos · /admin' + (require('../../../plugins/zero-divu/config').isZeroDivuEnabled() ? ' · 📱 WhatsApp (/wa_*)' : ''))}`,
                sessionCleared
            ),
            markup);
    }

    bot.action('a_menu', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin_callback', ctx); return; }
        await ctx.answerCbQuery();
        await renderAdminMenuPanel(ctx, 0);
    });

    bot.action(/^a_menu_p(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin_callback', ctx); return; }
        await ctx.answerCbQuery();
        const page = parseInt(ctx.match[1], 10) || 0;
        await renderAdminMenuPanel(ctx, page);
    });

    async function showAdminCommands(ctx, section = 'all') {
        await sendHelpJson(ctx, { section, isAdmin: true, adminPanel: true });
    }

    bot.action('a_comandos', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        await showAdminCommands(ctx, 'all');
    });

    const ADMIN_CMD_SECTIONS = {
        a_cmd_user: 'user',
        a_cmd_admin: 'admin',
        a_cmd_produtos: 'produtos',
        a_cmd_divulgacao: 'divulgacao',
        a_cmd_grupos: 'grupos',
        a_cmd_canais: 'canais',
        a_cmd_painel: 'painel',
        a_cmd_saas: 'saas',
        a_cmd_whatsapp: 'whatsapp',
        a_cmd_all: 'all',
    };
    for (const [cb, sec] of Object.entries(ADMIN_CMD_SECTIONS)) {
        bot.action(cb, async (ctx) => {
            if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
            await ctx.answerCbQuery();
            await showAdminCommands(ctx, sec);
        });
    }

    bot.action('a_stats', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        try {
            const db = dbRaw();
            const [u, , o, paid, pend, delivered, cancelled] = await Promise.all([
                prisma.user.count(), prisma.product.count({ where: { active: true } }),
                prisma.order.count(), prisma.order.count({ where: { status: 'PAID' } }),
                prisma.order.count({ where: { status: 'WAITING_PAYMENT' } }),
                prisma.order.count({ where: { status: 'DELIVERED' } }),
                prisma.order.count({ where: { status: { in: ['FAILED', 'CANCELLED'] } } }),
            ]);
            const revPaid = await prisma.order.aggregate({ where: { status: 'PAID' }, _sum: { total: true } });
            const revDel = await prisma.order.aggregate({ where: { status: 'DELIVERED' }, _sum: { total: true } });
            const totalRev = (revPaid._sum.total || 0) + (revDel._sum.total || 0);
            const vendas = paid + delivered;
            const hoje = db.prepare(`SELECT COUNT(*) as c, COALESCE(SUM(CASE WHEN status IN ('PAID','DELIVERED') THEN total ELSE 0 END),0) as r FROM orders WHERE date(created_at)=date('now')`).get();
            const spam = antiSpam.getStats();
            const txt =
                `${ADMIN_HTML.header('Estatísticas')}\n${ADMIN_HTML.small(new Date().toLocaleString('pt-BR'))}\n\n` +
                `👥 Usuários: ${ADMIN_HTML.yellow(String(u))} | 📋 Pedidos: ${o}\n` +
                `✅ Pagos: ${paid} | 📦 Entregues: ${delivered} | ⏳ Pend: ${pend}\n` +
                `💵 Total: ${ADMIN_HTML.green(`R$ ${totalRev.toFixed(2)}`)} | Hoje: ${ADMIN_HTML.green(`R$ ${Number(hoje.r).toFixed(2)}`)}\n` +
                `📈 Conversão: ${o > 0 ? ((vendas / o) * 100).toFixed(1) : 0}% | ⚠️ Bans: ${spam.bannedUsers}`;
            await editAdminPanel(ctx, txt, kb2(Markup, [
                [{ text: '🔄 Atualizar', callback_data: 'a_stats' }, { text: '📈 Gráfico', callback_data: 'a_chart' }],
                [{ text: '📈 Conversão', callback_data: 'a_analytics' }, { text: '📉 Funil', callback_data: 'a_analytics_funil' }],
                [{ text: '🔙 Admin', callback_data: 'a_menu' }],
            ]));
        } catch (e) {
            await Msg.reply(ctx, '❌ Erro: ' + e.message);
        }
    });

    bot.action('a_chart', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const db = dbRaw();
        const rows = db.prepare(`SELECT date(created_at) as dia, COUNT(*) as pedidos, COALESCE(SUM(CASE WHEN status IN ('PAID','DELIVERED') THEN total ELSE 0 END),0) as receita FROM orders WHERE created_at >= date('now','-7 days') GROUP BY dia ORDER BY dia ASC`).all();
        const maxPed = Math.max(...rows.map(r => r.pedidos), 1);
        let list = !rows.length ? ADMIN_HTML.small('Sem dados ainda.') : rows.map(r =>
            `<code>${r.dia.slice(5)}</code> ${'█'.repeat(Math.round(r.pedidos / maxPed * 10)).padEnd(10, '░')} <b>${r.pedidos}</b> — ${ADMIN_HTML.green(`R$${Number(r.receita).toFixed(0)}`)}`
        ).join('\n');
        await editAdminPanel(ctx, `${ADMIN_HTML.header('Gráfico — 7 Dias')}\n\n${list}`, kb2(Markup, [
            [{ text: '🔄 Atualizar', callback_data: 'a_chart' }, { text: '📊 Stats', callback_data: 'a_stats' }],
            [{ text: '🔙 Admin', callback_data: 'a_menu' }],
        ]));
    });

    bot.action('a_prods', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        try {
            const prods = await prisma.product.findMany({});
            if (!prods?.length) {
                return editAdminPanel(
                    ctx,
                    `${ADMIN_HTML.header('Produtos')}\n\n${ADMIN_HTML.red('Nenhum produto.')}\n\n` +
                        `<b>Comandos:</b>\n` +
                        `<code>/addproduto</code> · <code>/gerenciarprodutos</code>`,
                    kb2(Markup, [
                        [{ text: '➕ Criar', callback_data: 'prod_create' }],
                        [{ text: '📦 Gerenciar', callback_data: 'prod_menu_back' }],
                        [{ text: '🔙 Admin', callback_data: 'a_menu' }],
                    ])
                );
            }
            let list = '';
            prods.forEach((p) => {
                const est = p.stock >= 999 ? '∞' : p.stock <= 0 ? ADMIN_HTML.red('ESGOTADO') : ADMIN_HTML.yellow(String(p.stock));
                list += `${p.active ? ADMIN_HTML.green('✅') : ADMIN_HTML.red('⏸️')} <b>#${p.id}</b> ${p.name} — R$ ${Number(p.price).toFixed(2)} | ${est}\n`;
            });
            const cmdBlock =
                `\n<b>Comandos:</b>\n` +
                `<code>/gerenciarprodutos</code> · <code>/listprodutos</code>\n` +
                `<code>/produto ID</code> · <code>/editproduto ID</code>\n` +
                `<code>/removeproduto ID</code> · <code>/reativarproduto ID</code>`;
            const btns = prods.slice(0, 6).map((p) => [
                {
                    text: `${p.active ? '⏸️' : '▶️'} #${p.id} ${p.name.slice(0, 18)}`,
                    callback_data: p.active ? `prod_del_${p.id}` : `prod_reactivate_${p.id}`,
                },
                { text: '✏️', callback_data: `prod_edit_${p.id}` },
            ]);
            btns.push(
                [{ text: '📦 Gerenciar', callback_data: 'prod_menu_back' }, { text: '➕ Criar', callback_data: 'prod_create' }],
                [{ text: '📖 Comandos produtos', callback_data: 'a_cmd_produtos' }],
                [{ text: '🔙 Admin', callback_data: 'a_menu' }]
            );
            await editAdminPanel(
                ctx,
                `${ADMIN_HTML.header('Produtos')}\n${ADMIN_HTML.small(`${prods.length} itens`)}\n\n${list}${cmdBlock}`,
                kb2(Markup, btns)
            );
        } catch (e) {
            await Msg.reply(ctx, '❌ Erro: ' + e.message);
        }
    });

    bot.action(/^toggle_prod_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        const pid = parseInt(ctx.match[1]);
        const p = await prisma.product.findUnique({ where: { id: pid } });
        if (!p) return ctx.answerCbQuery('Não encontrado.');
        await prisma.product.update({ where: { id: pid }, data: { active: p.active ? 0 : 1 } });
        const user = await UserService.findByTelegramId(ctx.from.id);
        AuditService.log(user?.id, ctx.from.id, 'TOGGLE_PRODUCT', 'product', String(pid), { active: p.active }, { active: !p.active });
        await ctx.answerCbQuery(`${p.active ? '⏸️ Pausado' : '▶️ Ativado'}: ${p.name}`);
        const prods = await prisma.product.findMany({});
        let list = '';
        prods.forEach(pr => {
            const est = pr.stock >= 999 ? '∞' : pr.stock <= 0 ? ADMIN_HTML.red('ESGOTADO') : ADMIN_HTML.yellow(String(pr.stock));
            list += `${pr.active ? ADMIN_HTML.green('✅') : ADMIN_HTML.red('⏸️')} <b>${pr.name}</b> — R$ ${Number(pr.price).toFixed(2)} | ${est}\n`;
        });
        const btns = prods.slice(0, 8).map(pr => [{ text: `${pr.active ? '⏸️ Pausar' : '▶️ Ativar'} — ${pr.name.slice(0, 20)}`, callback_data: `toggle_prod_${pr.id}` }]);
        btns.push([{ text: '🔙 Admin', callback_data: 'a_menu' }]);
        await editAdminPanel(ctx, `${ADMIN_HTML.header('Produtos')}\n${ADMIN_HTML.small(`${prods.length} itens`)}\n\n${list}`, kb2(Markup, btns));
    });

    bot.action('a_spam', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const s = antiSpam.getStats();
        const recent = antiSpam.getRecentBans?.(6) || [];
        let list = '';
        for (const r of recent) {
            const uid = r.user_id || r.telegram_id || '?';
            const tag = r.permanent ? '🚫 permanente' : '⏱️ temporário';
            const motivo = (r.reason || r.violation_code || '—').slice(0, 42);
            list += `• <code>${uid}</code> ${tag} — ${motivo}\n`;
        }
        if (!list) list = `${ADMIN_HTML.small('Nenhuma penalidade ativa no momento.')}\n`;
        const txt =
            `${ADMIN_HTML.header('Proteção Anti-Abuso')}\n\n` +
            `${ADMIN_HTML.sub('📊 Agora')}\n` +
            `├─ 👁️ Sessões monitoradas: ${s.trackedUsers}\n` +
            `├─ ⏱️ Bloqueios temporários: ${ADMIN_HTML.yellow(String(s.bannedUsers))}\n` +
            `├─ 🚫 Blacklist: ${ADMIN_HTML.red(String(s.blacklisted))}\n` +
            `└─ ⚠️ Advertências ativas: ${s.warnedUsers}\n\n` +
            `${ADMIN_HTML.sub('⚙️ Regras')}\n` +
            `├─ ${antiSpam.WARN_LIMIT} advertências antes do 1º bloqueio\n` +
            `├─ Até ${antiSpam.MAX_ACTIONS} msgs / ${antiSpam.WINDOW / 1000}s\n` +
            `└─ Escalonamento: 30s → 2min → 10min → 30min → 24h → blacklist\n\n` +
            `${ADMIN_HTML.sub('📋 Penalidades recentes')}\n${list}`;
        await editAdminPanel(ctx, txt, kb2(Markup, [[{ text: '🔄 Atualizar', callback_data: 'a_spam' }], [{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
    });

    bot.action('a_maint', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const cur = getMaintenanceMode();
        setMaintenanceMode(!cur);
        await ctx.answerCbQuery(!cur ? '⛔ Manutenção ativada' : '✅ Manutenção desativada');
        await Msg.edit(ctx,
            `🔧 Manutenção: <b>${!cur ? 'ATIVADA ⛔' : 'DESATIVADA ✅'}</b>`,
            kb2(Markup, [[{ text: '🔄 Toggle', callback_data: 'a_maint' }], [{ text: '🔙', callback_data: 'a_menu' }]]));
    });

    bot.action('a_clear', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery('🧹 Limpando...');
        invalidateProductCache();
        invalidateBotUsername();
        await loadProducts();
        await Msg.edit(ctx, `🧹 <b>CACHES LIMPOS!</b>`, kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
    });

    bot.action('a_backup', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const BackupManager = require('../../../config/BackupManager');
        const st = BackupManager.getStatus();
        let txt = `${ADMIN_HTML.header('Backup de Dados')}\n\n`;
        txt += st.ok ? `${ADMIN_HTML.green('✅ Banco íntegro')}\n` : `${ADMIN_HTML.red('❌ Problema no banco')}\n`;
        txt += `📂 <code>backups/</code>\n`;
        txt += `📊 ${st.total}/${st.max} backups · a cada ${st.intervalHours}h\n`;
        txt += st.compress ? `🗜️ Compressão gzip ativa\n` : '';
        if (st.last) {
            const d = new Date(st.last.ts).toLocaleString('pt-BR');
            txt += `\n<b>Último:</b> ${d}\n`;
            txt += `📁 <code>${st.last.name}</code>\n`;
            txt += `📦 ${(st.last.size / 1024).toFixed(1)} KB · ${st.last.reason}\n`;
        } else {
            txt += `\n${ADMIN_HTML.yellow('Nenhum backup válido ainda')}\n`;
        }
        const recent = BackupManager.listBackups(3);
        if (recent.length > 1) {
            txt += `\n<b>Recentes:</b>\n`;
            for (const b of recent.slice(1)) {
                txt += `• ${new Date(b.ts).toLocaleDateString('pt-BR')} — ${(b.size / 1024).toFixed(0)} KB (${b.reason})\n`;
            }
        }
        txt += `\n${ADMIN_HTML.small('/backup — comando manual')}`;

        await editAdminPanel(ctx, txt, kb2(Markup, [
            [{ text: '💾 Criar backup agora', callback_data: 'a_backup_run' }],
            [{ text: '🔙 Admin', callback_data: 'a_menu' }],
        ]));
    });

    bot.action('a_backup_run', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery('💾 Criando…');
        const BackupManager = require('../../../config/BackupManager');
        await editAdminPanel(ctx, `${ADMIN_HTML.header('Backup')}\n\n⏳ Criando backup…`, null);
        const result = await BackupManager.createBackup('manual', true);
        if (!result) {
            return editAdminPanel(ctx,
                `${ADMIN_HTML.header('Backup')}\n\n${ADMIN_HTML.red('❌ Falhou ou já em andamento')}`,
            kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]])
            );
        }
        const c = result.counts || {};
        await editAdminPanel(ctx,
            `${ADMIN_HTML.header('Backup')}\n\n` +
            `${ADMIN_HTML.green('✅ Backup criado')}\n\n` +
            `📁 <code>${result.name}</code>\n` +
            `📦 ${(result.size / 1024).toFixed(1)} KB\n` +
            `👥 ${c.users ?? '?'} · 📋 ${c.orders ?? '?'} · 🛍️ ${c.products ?? '?'}`,
            kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]])
        );
    });

    bot.command('backup', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const BackupManager = require('../../../config/BackupManager');
        try {
            await Msg.reply(ctx, '💾 <b>Criando backup…</b>\n\nAguarde alguns segundos.', { parse_mode: 'HTML' });
            const result = await BackupManager.createBackup('manual', true);
            if (!result) {
                return Msg.reply(ctx, '⚠️ Backup não concluído (já em andamento ou falhou). Veja os logs.');
            }
            const c = result.counts || {};
            await Msg.reply(
                ctx,
                `✅ <b>Backup concluído</b>\n\n` +
                    `📁 <code>${result.name}</code>\n` +
                    `📦 ${(result.size / 1024).toFixed(1)} KB\n` +
                    `👥 ${c.users ?? '?'} usuários · 📋 ${c.orders ?? '?'} pedidos\n` +
                    `🔒 Integridade verificada`,
                { parse_mode: 'HTML' }
            );
        } catch (e) {
            await Msg.reply(ctx, '❌ Erro: ' + e.message);
        }
    });

    bot.action('a_carts', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const ativos = [...carrinhos.entries()].filter(([, c]) => c.items?.length > 0);
        if (!ativos.length) return editAdminPanel(ctx, `${ADMIN_HTML.header('Carrinhos')}\n\n${ADMIN_HTML.green('Nenhum ativo')}`, kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
        let list = '';
        ativos.slice(0, 15).forEach(([chatId, c]) => {
            const total = c.items.reduce((s, i) => s + i.price * i.quantity, 0);
            list += `👤 <code>${chatId}</code> — ${ADMIN_HTML.yellow(`R$ ${total.toFixed(2)}`)}\n`;
        });
        await editAdminPanel(ctx, `${ADMIN_HTML.header('Carrinhos Ativos')}\n${ADMIN_HTML.small(`${ativos.length} ativos`)}\n\n${list}`, kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
    });

}

module.exports = { registerPanelHandlers };
