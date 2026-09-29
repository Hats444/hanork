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


/** Tickets, cupons, afiliados — M4 */
function registerCrmHandlers(bot, deps) {
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

    bot.action('a_tickets', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const open = await prisma.ticket.findOpen();
        if (!open.length) return editAdminPanel(ctx, `${ADMIN_HTML.header('Tickets')}\n\n${ADMIN_HTML.green('Nenhum aberto')}`, kb2(Markup, [[{ text: 'Voltar admin', callback_data: 'a_menu' }]]));
        let list = '';
        open.slice(0, 10).forEach(t => { list += `#${t.id} — <code>${t.telegram_id}</code>\n${t.message.slice(0, 60)}\n\n`; });
        const btns = open.slice(0, 6).map(t => [{ text: `#${t.id}`, callback_data: `ticket_${t.id}` }]);
        btns.push([{ text: 'Voltar admin', callback_data: 'a_menu' }]);
        await editAdminPanel(ctx, `${ADMIN_HTML.header('Tickets')} (${open.length})\n\n${list}`, kb2(Markup, btns));
    });

    bot.action('a_cupons', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const cupons = dbRaw().prepare('SELECT * FROM coupons ORDER BY active DESC, created_at DESC LIMIT 20').all();
        if (!cupons.length) return editAdminPanel(ctx, `${ADMIN_HTML.header('Cupons')}\n\n${ADMIN_HTML.red('Nenhum cadastrado')}`, kb2(Markup, [[{ text: 'Criar', callback_data: 'a_addcupom' }], [{ text: 'Voltar admin', callback_data: 'a_menu' }]]));
        let list = '';
        cupons.forEach(c => { list += `${c.active ? 'ativo' : 'inativo'} <code>${c.code}</code> — ${c.type === 'percent' ? `${c.value}%` : `R$ ${Number(c.value).toFixed(2)}`} | ${c.used || 0}/${c.max_uses === 999 ? '∞' : c.max_uses}\n`; });
        await editAdminPanel(ctx, `${ADMIN_HTML.header(`Cupons (${cupons.length})`)}\n\n${list}`, kb2(Markup, [[{ text: 'Criar', callback_data: 'a_addcupom' }], [{ text: 'Voltar admin', callback_data: 'a_menu' }]]));
    });

    bot.action('a_addcupom', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        await editAdminPanel(ctx,
            `${ADMIN_HTML.header('Criar Cupom')}\n\nComando:\n<code>/addcupom CODIGO p|f VALOR [max] [dias]</code>\n\n<code>/addcupom PROMO10 p 10</code> — 10% ilimitado`,
            kb2(Markup, [[{ text: 'Voltar cupons', callback_data: 'a_cupons' }]]));
    });

    bot.command('addcupom', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const parts = ctx.message.text.trim().split(/\s+/);
        if (parts.length < 4) {
            return Msg.reply(
                ctx,
                '<b>Criar cupom</b>\n\n' +
                    '<code>/addcupom CODIGO p|f VALOR [max_usos] [dias_validade]</code>\n\n' +
                    '<code>p</code> = percentual · <code>f</code> = valor fixo\n' +
                    'Ex: <code>/addcupom PROMO10 p 10</code>\n' +
                    'Ex: <code>/addcupom OFF5 f 5 100 30</code>',
                { parse_mode: 'HTML' }
            );
        }
        const code = parts[1].toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        const typeRaw = parts[2].toLowerCase();
        const type =
            typeRaw === 'p' || typeRaw === 'percent' ? 'percent' : typeRaw === 'f' || typeRaw === 'fixed' ? 'fixed' : null;
        const value = parseFloat(parts[3].replace(',', '.'));
        const maxUses = parseInt(parts[4] || '0', 10) || 0;
        const days = parseInt(parts[5] || '0', 10) || 0;
        if (!code || !type || Number.isNaN(value) || value <= 0) {
            return Msg.reply(ctx, 'Formato inválido. Use /addcupom sem argumentos para ver o modelo.');
        }
        if (type === 'percent' && value > 100) {
            return Msg.reply(ctx, 'Desconto percentual não pode passar de 100%.');
        }
        const db = dbRaw();
        let expiresAt = null;
        if (days > 0) {
            const exp = new Date();
            exp.setDate(exp.getDate() + days);
            expiresAt = exp.toISOString();
        }
        try {
            db.prepare(
                `INSERT INTO coupons (code, type, value, max_uses, used, active, expires_at) VALUES (?,?,?,?,0,1,?)
                 ON CONFLICT(code) DO UPDATE SET type=excluded.type, value=excluded.value, max_uses=excluded.max_uses, active=1, expires_at=excluded.expires_at`
            ).run(code, type, value, maxUses, expiresAt);
            await Msg.reply(
                ctx,
                `Cupom <code>${code}</code> salvo!\n` +
                    `Tipo: ${type === 'percent' ? value + '%' : 'R$ ' + value.toFixed(2)}\n` +
                    (maxUses ? `Máx. usos: ${maxUses}\n` : 'Usos: ilimitado\n') +
                    (expiresAt ? `Validade: ${days} dias` : 'Sem data de expiração'),
                { parse_mode: 'HTML' }
            );
        } catch (e) {
            await Msg.reply(ctx, 'Erro ao criar cupom: ' + e.message);
        }
    });

    bot.action('a_afiliados', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const db = dbRaw();
        const stats = db.prepare(`
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(earnings), 0) AS balance,
                   COALESCE(SUM(referred_count), 0) AS referrals,
                   COALESCE(SUM(sales_count), 0) AS sales
            FROM affiliates
        `).get();
        const pendingWd = db.prepare(`
            SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS sum
            FROM affiliate_withdrawals WHERE status = 'pending'
        `).get();
        const afiliados = db.prepare(`
            SELECT a.*, u.first_name, u.username, u.telegram_id,
                   (SELECT COUNT(*) FROM referrals r WHERE r.affiliate_id = a.id) AS referrals
            FROM affiliates a
            LEFT JOIN users u ON u.id = a.user_id
            ORDER BY a.earnings DESC
            LIMIT 15
        `).all();
        if (!afiliados.length) {
            return editAdminPanel(
                ctx,
                `${ADMIN_HTML.header('Programa de Afiliados')}\n\n${ADMIN_HTML.yellow('Nenhum afiliado cadastrado ainda.')}`,
                kb2(Markup, [[{ text: 'Voltar admin', callback_data: 'a_menu' }]])
            );
        }
        let list =
            `${ADMIN_HTML.header('Programa de Afiliados')}\n\n` +
            `<b>Resumo</b>\n` +
            `├ Afiliados: ${stats.total || 0}\n` +
            `├ Saldo total em carteira: ${ADMIN_HTML.green(`R$ ${Number(stats.balance || 0).toFixed(2)}`)}\n` +
            `├ Indicações: ${stats.referrals || 0}\n` +
            `└ Vendas com comissão: ${stats.sales || 0}\n\n` +
            `<b>Top afiliados</b>\n\n`;
        afiliados.forEach((a, i) => {
            const nome = a.first_name || a.username || a.telegram_id;
            list += `${i + 1}. <b>${String(nome).slice(0, 20)}</b>\n`;
            list += `   <code>${a.code}</code> · R$ ${Number(a.earnings || 0).toFixed(2)}\n`;
            list += `   ${a.referrals} indicados · ${a.sales_count || 0} vendas\n\n`;
        });
        const wdPending = pendingWd?.c || 0;
        const rows = [[{ text: 'Voltar admin', callback_data: 'a_menu' }]];
        if (wdPending > 0) {
            rows.unshift([{
                text: `Saques pendentes (${wdPending}) — R$ ${Number(pendingWd.sum || 0).toFixed(2)}`,
                callback_data: 'a_withdrawals',
            }]);
        }
        await editAdminPanel(ctx, list, kb2(Markup, rows));
    });

    bot.action('a_withdrawals', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const db = dbRaw();
        const list = db.prepare(`
            SELECT w.*, u.telegram_id, u.first_name, u.username, a.code
            FROM affiliate_withdrawals w
            JOIN users u ON u.id = w.user_id
            JOIN affiliates a ON a.id = w.affiliate_id
            WHERE w.status = 'pending'
            ORDER BY w.created_at ASC
            LIMIT 10
        `).all();
        if (!list.length) {
            return editAdminPanel(ctx, `${ADMIN_HTML.header('Saques')}\n\n${ADMIN_HTML.green('Nenhum saque pendente')}`, kb2(Markup, [[{ text: 'Voltar afiliados', callback_data: 'a_afiliados' }], [{ text: 'Voltar admin', callback_data: 'a_menu' }]]));
        }
        let txt = `${ADMIN_HTML.header('Saques Pendentes')}\n\n`;
        const btns = [];
        for (const w of list) {
            const nome = w.first_name || w.username || w.telegram_id;
            const dt = (w.created_at || '').slice(0, 16).replace('T', ' ');
            txt += `#${w.id} — <b>${String(nome).slice(0, 18)}</b>\n`;
            txt += `   R$ ${Number(w.amount).toFixed(2)} · <code>${w.code || '—'}</code>\n`;
            txt += `   <code>${w.telegram_id}</code> · ${dt}\n\n`;
            btns.push([
                { text: `Aprovar #${w.id}`, callback_data: `aff_wd_ok_${w.id}` },
                { text: `Recusar #${w.id}`, callback_data: `aff_wd_no_${w.id}` },
            ]);
        }
        btns.push([{ text: 'Voltar afiliados', callback_data: 'a_afiliados' }]);
        await editAdminPanel(ctx, txt, kb2(Markup, btns));
    });

    bot.action(/^aff_wd_ok_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const wdId = parseInt(ctx.match[1], 10);
        const db = dbRaw();
        const w = db.prepare('SELECT * FROM affiliate_withdrawals WHERE id = ?').get(wdId);
        if (!w || w.status !== 'pending') return ctx.answerCbQuery('Saque já processado.', { show_alert: true });
        const { withLockOrSkip } = require('../../../infrastructure/DistributedStateManager');
        const done = await withLockOrSkip(`aff_wd:${wdId}`, 20000, async () => {
            const cur = db.prepare('SELECT status FROM affiliate_withdrawals WHERE id = ?').get(wdId);
            if (!cur || cur.status !== 'pending') return false;
            db.prepare("UPDATE affiliate_withdrawals SET status = 'approved', processed_at = datetime('now') WHERE id = ?").run(wdId);
            return true;
        });
        if (!done) return ctx.answerCbQuery('Saque já está sendo processado.', { show_alert: true });
        const user = await prisma.user.findUnique({ where: { id: w.user_id } });
        if (user?.telegram_id) {
            try {
                await ctx.telegram.sendMessage(user.telegram_id,
                    `<b>Saque aprovado!</b>\n\nR$ ${Number(w.amount).toFixed(2)}\nSolicitação #${wdId}\n\nO pagamento será feito via PIX conforme dados informados ao suporte.`,
                    { parse_mode: 'HTML' });
            } catch { /* ignore */ }
        }
        await ctx.answerCbQuery('Aprovado');
        await ctx.editMessageReplyMarkup(normalizeReplyMarkup({ inline_keyboard: [[{ text: 'Processado', callback_data: 'noop' }]] })).catch(() => {});
        logger.info('[Withdraw] approved', { wdId, admin: ctx.from.id });
    });

    bot.action(/^aff_wd_no_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const wdId = parseInt(ctx.match[1], 10);
        const db = dbRaw();
        const w = db.prepare('SELECT * FROM affiliate_withdrawals WHERE id = ?').get(wdId);
        if (!w || w.status !== 'pending') return ctx.answerCbQuery('Saque já processado.', { show_alert: true });
        const { withLockOrSkip } = require('../../../infrastructure/DistributedStateManager');
        const done = await withLockOrSkip(`aff_wd:${wdId}`, 20000, async () => {
            const cur = db.prepare('SELECT * FROM affiliate_withdrawals WHERE id = ?').get(wdId);
            if (!cur || cur.status !== 'pending') return false;
            db.prepare("UPDATE affiliate_withdrawals SET status = 'rejected', processed_at = datetime('now') WHERE id = ?").run(wdId);
            db.prepare('UPDATE affiliates SET earnings = earnings + ? WHERE id = ?').run(w.amount, w.affiliate_id);
            return true;
        });
        if (!done) return ctx.answerCbQuery('Saque já está sendo processado.', { show_alert: true });
        const user = await prisma.user.findUnique({ where: { id: w.user_id } });
        if (user?.telegram_id) {
            try {
                await ctx.telegram.sendMessage(user.telegram_id,
                    `<b>Saque recusado</b>\n\nR$ ${Number(w.amount).toFixed(2)} devolvido ao seu saldo.\nSolicitação #${wdId}\n\nDúvidas? Fale com o suporte.`,
                    { parse_mode: 'HTML' });
            } catch { /* ignore */ }
        }
        await ctx.answerCbQuery('Recusado — saldo devolvido');
        await ctx.editMessageReplyMarkup(normalizeReplyMarkup({ inline_keyboard: [[{ text: 'Recusado', callback_data: 'noop' }]] })).catch(() => {});
        logger.info('[Withdraw] rejected', { wdId, admin: ctx.from.id });
    });
}

module.exports = { registerCrmHandlers };
