'use strict';

const { denySilent, denyCbSilent } = require('../../../utils/silencedAccess');

const { normalizeReplyMarkup } = require('../../menus/twoColKeyboard');
const { pickAdminDeps } = require('./deps');

function createShowUsers(deps) {
    const { isAdmin, dbRaw, bannedUsers, Msg, Markup } = deps;

    return async function showUsers(ctx, pageIndex = 0) {
        if (!isAdmin(ctx.from.id)) {
            await denyCbSilent('admin_users', ctx);
            return;
        }
        const limit = 15;
        const offset = Math.max(0, pageIndex) * limit;
        const db = dbRaw();
        const total = db.prepare('SELECT COUNT(*) as c FROM users').get()?.c || 0;
        const users = db
            .prepare(
                `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.created_at,
               COUNT(o.id) as order_count,
               COALESCE(SUM(CASE WHEN o.status = 'DELIVERED' THEN o.total ELSE 0 END), 0) as total_gasto
        FROM users u
        LEFT JOIN orders o ON o.user_id = u.id
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT ? OFFSET ?`
            )
            .all(limit, offset);
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const pageNum = pageIndex + 1;
        let txt = `<b>Usuários</b> — ${pageNum}/${totalPages} (total: ${total})\n\n`;
        for (const u of users) {
            const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Sem nome';
            const username = u.username ? ` @${u.username}` : '';
            const banned = bannedUsers.has(parseInt(u.telegram_id, 10));
            txt += `${banned ? '[ban]' : ''} <code>${u.telegram_id}</code>${username} — ${name}\n`;
            txt += `   ${u.order_count} pedidos | R$ ${Number(u.total_gasto).toFixed(2)}\n\n`;
        }
        const navBtns = [];
        if (pageIndex > 0) navBtns.push({ text: 'Anterior', callback_data: `a_users_p_${pageIndex - 1}` });
        if (pageIndex + 1 < totalPages) navBtns.push({ text: 'Próxima', callback_data: `a_users_p_${pageIndex + 1}` });
        const kb = [];
        if (navBtns.length) kb.push(navBtns);
        kb.push([{ text: 'Voltar admin', callback_data: 'a_menu' }]);
        const markup = Markup.inlineKeyboard(kb);
        if (ctx.callbackQuery) {
            await Msg.edit(ctx, txt, markup);
        } else {
            await Msg.reply(ctx, txt, { parse_mode: 'HTML', reply_markup: markup.reply_markup });
        }
    };
}

/** B3 — /usuarios, /userinfo e callbacks ui_* */
function registerUsersHandlers(bot, deps) {
    const d = pickAdminDeps(deps);
    const {
        prisma,
        dbRaw,
        Markup,
        isAdmin,
        Msg,
        logger,
        bot: telegramBot,
        antiSpam,
        botSession,
        sessionNote,
        adminMsgTarget,
        bannedUsers,
    } = d;

    async function renderUsersPage(ctx, page, editFirst = false) {
        const limit = 15;
        const offset = (page - 1) * limit;
        const db = dbRaw();
        const total = db.prepare('SELECT COUNT(*) as c FROM users').get()?.c || 0;
        const users = db
            .prepare(
                `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.created_at,
                   COUNT(o.id) as order_count,
                   COALESCE(SUM(CASE WHEN o.status = 'DELIVERED' THEN o.total ELSE 0 END), 0) as total_gasto
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.id
            GROUP BY u.id
            ORDER BY u.created_at DESC
            LIMIT ? OFFSET ?`
            )
            .all(limit, offset);
        const totalPages = Math.max(1, Math.ceil(total / limit));
        let txt = `<b>Usuários</b> — Página ${page}/${totalPages} (total: ${total})\n\n`;
        for (const u of users) {
            const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Sem nome';
            const username = u.username ? ` @${u.username}` : '';
            const banned = bannedUsers.has(parseInt(u.telegram_id, 10));
            txt += `${banned ? '[ban]' : ''} <code>${u.telegram_id}</code>${username} — ${name}\n`;
            txt += `   ${u.order_count} pedidos | R$ ${Number(u.total_gasto).toFixed(2)}\n\n`;
        }
        const navBtns = [];
        if (page > 1) navBtns.push({ text: 'Anterior', callback_data: `usuarios_pg_${page - 1}` });
        if (page < totalPages) navBtns.push({ text: 'Próxima', callback_data: `usuarios_pg_${page + 1}` });
        const kb = [];
        if (navBtns.length) kb.push(navBtns);
        kb.push([{ text: 'Voltar admin', callback_data: 'a_menu' }]);
        await Msg.sendLongHtml(ctx, txt, Markup.inlineKeyboard(kb), { editFirst });
    }

    bot.command('usuarios', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        try {
            const parts = ctx.message.text.split(' ');
            const page = Math.max(1, parseInt(parts[1], 10) || 1);
            await renderUsersPage(ctx, page, false);
        } catch (e) {
            logger.error('[USUARIOS] Erro:', e.message);
            await Msg.reply(ctx, 'Erro ao listar usuários: ' + e.message);
        }
    });

    bot.action(/^usuarios_pg_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin_callback', ctx); return; }
        await ctx.answerCbQuery();
        const page = Math.max(1, parseInt(ctx.match[1], 10) || 1);
        try {
            await renderUsersPage(ctx, page, true);
        } catch (e) {
            logger.error('[USUARIOS] Paginação erro:', e.message);
        }
    });

    bot.command('userinfo', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const parts = ctx.message.text.split(' ');
        const rawId = parts[1];
        if (!rawId) return Msg.reply(ctx, 'Use: `/userinfo TELEGRAM_ID`', { parse_mode: 'HTML' });
        const user = await prisma.user.findUnique({ where: { telegram_id: rawId } });
        if (!user) return Msg.reply(ctx, 'Usuário não encontrado.');
        const orders = await prisma.order.findMany({ where: { user_id: user.id } });
        const delivered = orders.filter((o) => o.status === 'DELIVERED');
        const totalGasto = delivered.reduce((s, o) => s + o.total, 0);
        const favCount = (await prisma.favorite.findByUser(user.id)).length;
        const tickets = await prisma.ticket.findByUser(user.id);
        const banned = bannedUsers.has(parseInt(user.telegram_id, 10));
        let txt = `<b>Perfil do Usuário</b>\n\n`;
        txt += `ID: <code>${user.telegram_id}</code>\n`;
        txt += `Nome: ${user.first_name || '?'}${user.last_name ? ' ' + user.last_name : ''}\n`;
        txt += `Username: ${user.username ? '@' + user.username : 'não informado'}\n`;
        txt += `Cadastro: ${new Date(user.created_at).toLocaleDateString('pt-BR')}\n\n`;
        txt += `<b>Atividade:</b>\n`;
        txt += `Pedidos: ${orders.length} (${delivered.length} entregues)\n`;
        txt += `Total gasto: R$ ${totalGasto.toFixed(2)}\n`;
        txt += `Favoritos: ${favCount}\n`;
        txt += `Tickets: ${tickets.length}\n`;
        txt += `Banido: ${banned ? 'SIM' : 'não'}\n`;
        const btns = [[{ text: banned ? 'Desbanir' : 'Banir', callback_data: `ui_${banned ? 'unban' : 'ban'}_${user.telegram_id}` }]];
        btns.push([{ text: 'Enviar mensagem', callback_data: `ui_msg_${user.telegram_id}` }]);
        btns.push([{ text: 'Voltar admin', callback_data: 'a_menu' }]);
        await Msg.edit(ctx, txt, Markup.inlineKeyboard(btns));
    });

    bot.action(/^ui_(ban|unban)_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const action = ctx.match[1];
        const uid = parseInt(ctx.match[2], 10);
        if (action === 'ban') {
            bannedUsers.add(uid);
            antiSpam.banUser(uid, true, 'suspensão administrativa da conta');
            await ctx.answerCbQuery('Usuário banido.');
            try {
                const { buildManualBanMessage } = require('../../../modules/security/BanMessages');
                await telegramBot.telegram.sendMessage(uid, buildManualBanMessage('suspensão administrativa da conta'), {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                });
            } catch {
                /* ignore */
            }
        } else {
            bannedUsers.delete(uid);
            antiSpam.unbanUser(uid);
            await ctx.answerCbQuery('Usuário desbanido.');
            try {
                await telegramBot.telegram.sendMessage(
                    uid,
                    '<b>Sua conta foi reativada.</b>\n\nVocê pode usar o bot normalmente. Envie /start para abrir o menu.',
                    { parse_mode: 'HTML' }
                );
            } catch {
                /* ignore */
            }
        }
        await ctx.editMessageReplyMarkup(
            normalizeReplyMarkup({
                inline_keyboard: [
                    [
                        {
                            text: action === 'ban' ? 'Desbanir' : 'Banir',
                            callback_data: `ui_${action === 'ban' ? 'unban' : 'ban'}_${uid}`,
                        },
                    ],
                    [{ text: 'Voltar admin', callback_data: 'a_menu' }],
                ],
            })
        );
    });

    bot.action(/^ui_msg_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const cleared = await botSession.enterAdminFlow(ctx, 'adminMsg');
        await adminMsgTarget.set(ctx.from.id, ctx.match[1]);
        await Msg.edit(
            ctx,
            sessionNote(`<b>Enviar mensagem para <code>${ctx.match[1]}</code></b>\n\nDigite a mensagem:`, cleared),
            Markup.inlineKeyboard([[{ text: 'Cancelar', callback_data: 'a_menu' }]])
        );
        await ctx.answerCbQuery();
    });
}

module.exports = { createShowUsers, registerUsersHandlers };
