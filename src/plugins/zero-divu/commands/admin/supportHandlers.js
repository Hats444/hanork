'use strict';

const { denyCbSilent } = require('../../../utils/silencedAccess');

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


/** Reviews, tickets chat, sorteios — M4 */
function registerSupportHandlers(bot, deps) {
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

    bot.action('a_reviews', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        try {
            const stats = await prisma.review.stats();
            const recent = await prisma.review.findMany({ limit: 8 });
            const db = dbRaw();
            const dist = db.prepare('SELECT rating, COUNT(*) as c FROM reviews GROUP BY rating ORDER BY rating DESC').all();
            const stars = n => '⭐'.repeat(n) + '☆'.repeat(5 - n);
            const totalStars = dist.reduce((s, r) => s + r.c, 0);
            let distTxt = '';
            if (dist.length) {
                for (let i = 5; i >= 1; i--) {
                    const row = dist.find(r => r.rating === i);
                    const cnt = row ? row.c : 0;
                    const pct = totalStars > 0 ? Math.round((cnt / totalStars) * 8) : 0;
                    distTxt += `${i}⭐ ${'█'.repeat(pct)}${'░'.repeat(8 - pct)} ${cnt}\n`;
                }
            }
            let recentTxt = '';
            if (recent.length) {
                recent.forEach(r => {
                    const comentario = r.comment ? ` — ${ADMIN_HTML.small(r.comment.slice(0, 30))}` : '';
                    recentTxt += `${stars(r.rating)} #${r.order_id.slice(-6)}${comentario}\n`;
                });
            }
            const txt =
                `${ADMIN_HTML.header('Avaliações')}\n\n` +
                `Média: ${ADMIN_HTML.yellow(`${stats.avg}/5`)} ${stars(Math.round(stats.avg || 0))}\n` +
                `Total: ${ADMIN_HTML.yellow(String(stats.total))} avaliações\n\n` +
                (distTxt ? `${ADMIN_HTML.sub('Distribuição:')}\n${distTxt}\n` : '') +
                (recentTxt ? `${ADMIN_HTML.sub('Últimas:')}\n${recentTxt}` : '');
            await editAdminPanel(ctx, txt, kb2(Markup, [[{ text: '🔄 Atualizar', callback_data: 'a_reviews' }], [{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
        } catch (e) {
            logger.error('a_reviews error:', e.message);
            await Msg.reply(ctx, '❌ Erro: ' + e.message.slice(0, 100));
        }
    });


    bot.action(/^ticket_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const id = parseInt(ctx.match[1]);
        const t = await prisma.ticket.findById(id);
        if (!t) return ctx.answerCbQuery('Ticket não encontrado.');
        const msgs = await prisma.ticket.getMessages(id);
        let txt = `<b>🎫 Ticket #${t.id}</b>\n👤 \<code>${t.telegram_id}\</code>\n📅 ${new Date(t.created_at).toLocaleDateString('pt-BR')}\n\n`;
        txt += `<b>Histórico:</b>\n`;
        msgs.slice(-10).forEach(m => {
            txt += m.sender === 'user' ? `👤 ${m.content}\n` : `🛡️ ${m.content}\n`;
        });
        await Msg.edit(ctx,
            txt,
            kb2(Markup, [
                [{ text: '💬 Entrar no Chat', callback_data: `tchat_${t.id}` }],
                [{ text: '🔴 Encerrar Ticket', callback_data: `tclose_${t.id}` }, { text: '🔙 Tickets', callback_data: 'a_tickets' }],
            ])
        );
        await ctx.answerCbQuery();
    });

    // Admin entra no chat do ticket
    bot.action(/^tchat_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const ticketId = parseInt(ctx.match[1]);
        const t = await prisma.ticket.findById(ticketId);
        if (!t || t.status !== 'open') return ctx.answerCbQuery('Ticket fechado ou não encontrado.');
        // Se já está em outro chat, encerrar primeiro
        const prevSess = await activeChats.get(ctx.from.id);
        if (prevSess && prevSess.ticketId !== ticketId) {
            await activeChats.delete(ctx.from.id);
        }
        const userChatId = parseInt(t.telegram_id);
        await openTicketChat(ctx, ticketId, userChatId, ctx.from.id);
        const msgs = await prisma.ticket.getMessages(ticketId);
        let hist = msgs.slice(-10).map(m => m.sender === 'user' ? `👤 ${m.content}` : `🛡️ ${m.content}`).join('\n');
        await Msg.edit(ctx,
            `💬 <b>Chat — Ticket #${ticketId}</b>\n\n${hist ? `*Histórico:*\n${hist}\n\n` : ''}<b>Você está conectado.</b> Digite sua mensagem:`,
            ticketCloseKeyboard(ticketId, true)
        );
        // Notificar usuário que o suporte entrou
        try {
            await bot.telegram.sendMessage(userChatId,
                `🟢 <b>Suporte conectado ao Ticket #${ticketId}!</b>\n\nContinue digitando normalmente.\n_Clique abaixo para encerrar o ticket._`,
                { parse_mode: 'HTML', reply_markup: ticketCloseKeyboard(ticketId).reply_markup }
            );
        } catch { }
        await ctx.answerCbQuery('✅ Chat iniciado!');
    });

    // Encerrar ticket — ambos os lados
    bot.action(/^tclose_(\d+)$/, async (ctx) => {
        const ticketId = parseInt(ctx.match[1]);
        const name = isAdmin(ctx.from.id) ? 'Suporte' : (ctx.from.first_name || 'Usuário');
        await ctx.answerCbQuery('🔴 Encerrando...');
        await closeTicketChat(ticketId, ctx.from.id, name);
        if (isAdmin(ctx.from.id)) {
            await Msg.edit(ctx, `🔴 <b>Ticket #${ticketId} encerrado.</b>`, kb2(Markup, [
                [{ text: '🎫 Ver Tickets', callback_data: 'a_tickets' }],
                [{ text: '🔙 Admin', callback_data: 'a_menu' }],
            ]));
        } else {
            await Msg.edit(ctx, `🔴 <b>Ticket #${ticketId} encerrado.</b>\n\n_Obrigado pelo contato! Se precisar de mais ajuda, abra um novo suporte._`, kb2(Markup, [
                [{ text: '🎫 Novo Suporte', callback_data: 'suporte_btn' }],
                [{ text: '🏠 Menu', callback_data: 'home' }],
            ]));
        }
    });

    const ticketReplyMode = new Map(); // legado — mantido para compatibilidade

    bot.action(/^ticket_reply_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        // Redirecionar para o novo sistema de chat
        const ticketId = parseInt(ctx.match[1]);
        const t = await prisma.ticket.findById(ticketId);
        if (!t || t.status !== 'open') return ctx.answerCbQuery('Ticket fechado.');
        const userChatId = parseInt(t.telegram_id);
        await openTicketChat(ctx, ticketId, userChatId, ctx.from.id);
        const msgs = await prisma.ticket.getMessages(ticketId);
        let hist = msgs.slice(-10).map(m => m.sender === 'user' ? `👤 ${m.content}` : `🛡️ ${m.content}`).join('\n');
        await Msg.edit(ctx,
            `💬 <b>Chat — Ticket #${ticketId}</b>\n\n<b>Mensagem original:</b>\n${t.message}\n\n<b>Você está conectado.</b> Digite sua resposta:`,
            ticketCloseKeyboard(ticketId, true)
        );
        try {
            await bot.telegram.sendMessage(userChatId,
                `🟢 <b>Suporte conectado!</b> Ticket #${ticketId}\n\n_Digite normalmente para responder._`,
                { parse_mode: 'HTML', reply_markup: ticketCloseKeyboard(ticketId).reply_markup }
            );
        } catch { }
        await ctx.answerCbQuery();
    });


    bot.action('a_giveaways', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const { txt, rows } = await buildGiveawaysPanel();
        await Msg.edit(ctx, txt, kb2(Markup, rows));
    });

    bot.action(/^gw_draw_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        const gid = parseInt(ctx.match[1]);
        const g = await prisma.giveaway.findById(gid);
        if (!g) return ctx.answerCbQuery('Sorteio não encontrado.');
        const parts = dbRaw().prepare('SELECT COUNT(*) as c FROM giveaway_participants WHERE giveaway_id=?').get(gid)?.c || 0;
        await ctx.answerCbQuery();
        await Msg.edit(ctx,
            `🎲 <b>Confirmar Sorteio</b>\n\n<b>${g.name}</b>\n🎁 Prêmio: ${g.prize}\n👥 Participantes: ${parts}\n\n⚠️ Esta ação é irreversível!`,
            kb2(Markup, [
                [{ text: '✅ Confirmar Sorteio', callback_data: `gw_confirm_${gid}` }],
                [{ text: '🔙 Voltar', callback_data: 'a_giveaways' }],
            ])
        );
    });

    bot.action(/^gw_confirm_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        const gid = parseInt(ctx.match[1]);
        const winner_id = prisma.giveaway.drawWinner(gid);
        await ctx.answerCbQuery();
        if (!winner_id) {
            return Msg.edit(ctx, '❌ Nenhum participante no sorteio.', kb2(Markup, [[{ text: '🔙 Voltar', callback_data: 'a_giveaways' }]]));
        }
        const winner = await prisma.user.findUnique({ where: { id: winner_id } });
        const g = prisma.giveaway.findById(gid);
        const winnerTag = winner?.username ? `@${winner.username}` : `ID ${winner?.telegram_id}`;
        await Msg.edit(ctx,
            `🏆 <b>Sorteio Realizado!</b>\n\n<b>${g?.name}</b>\n🎁 Prêmio: ${g?.prize}\n👤 Vencedor: ${winnerTag}\n\n🎊 Notificação enviada ao vencedor!`,
            kb2(Markup, [[{ text: '🔙 Sorteios', callback_data: 'a_giveaways' }]])
        );
        try {
            if (winner?.telegram_id) {
                await bot.telegram.sendMessage(parseInt(winner.telegram_id),
                    `🏆 <b>Parabéns! Você ganhou o sorteio "${g?.name}"!</b>\n\n🎁 Prêmio: ${g?.prize}\n\nEntre em contato com o suporte para retirar seu prêmio.`,
                    { parse_mode: 'HTML' }
                );
            }
        } catch { }
    });

    bot.action('gw_cancel_list', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const active = prisma.giveaway.findActive();
        const rows = active.map(g => [{ text: `❌ #${g.id} — ${g.name}`, callback_data: `gw_cancel_${g.id}` }]);
        rows.push([{ text: '🔙 Voltar', callback_data: 'a_giveaways' }]);
        await Msg.edit(ctx, '❌ *Selecione o sorteio para cancelar:*', kb2(Markup, rows));
    });

    bot.action(/^gw_cancel_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        const gid = parseInt(ctx.match[1]);
        dbRaw().prepare("UPDATE giveaways SET status='cancelled' WHERE id=?").run(gid);
        await ctx.answerCbQuery('✅ Sorteio cancelado');
        const { txt, rows } = await buildGiveawaysPanel();
        await Msg.edit(ctx, txt, kb2(Markup, rows));
    });


    // Handler: ver participantes de um sorteio (contexto: admin vem de a_giveaways, user vem do card)
    bot.action(/^view_giveaway_(\d+)(?:_(\d+))?$/, async (ctx) => {
        const gid = parseInt(ctx.match[1]);
        const idx = ctx.match[2] !== undefined ? parseInt(ctx.match[2]) : null;
        await ctx.answerCbQuery();
        const g = await prisma.giveaway.findById(gid);
        if (!g) return Msg.reply(ctx, 'Sorteio não encontrado.');
        const parts = await prisma.giveaway.getParticipants(gid);
        let txt = `👥 <b>Participantes — ${g.name}</b>\n\nTotal: <b>${parts.length}</b>\n\n`;
        for (const p of parts.slice(0, 30)) {
            const u = await prisma.user.findUnique({ where: { id: p.user_id } });
            const tag = u?.username ? `@${u.username}` : `#${u?.telegram_id}`;
            txt += `• ${tag}${p.tickets > 1 ? ` (${p.tickets} tickets)` : ''}\n`;
        }
        if (parts.length > 30) txt += `\n_...e mais ${parts.length - 30} participantes._`;
        const backBtn = idx !== null
            ? [{ text: '🔙 Voltar ao Sorteio', callback_data: `view_giveaway_${gid}` }]
            : [{ text: '🔙 Voltar', callback_data: 'a_giveaways' }];
        await Msg.edit(ctx, txt, kb2(Markup, [backBtn]));
    });


    bot.action('gw_create', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const cleared = botSession ? await botSession.enterAdminFlow(ctx, 'giveaway') : {};
        await giveawayMode.set(ctx.from.id, { step: 'name', data: {}, _ts: Date.now() });
        await Msg.reply(ctx,
            appendSessionDiscardedNote(
                `➕ <b>Criar Sorteio — Passo 1/5</b>\n\n<b>Qual é o nome do sorteio?</b>\n_(ex: Sorteio de Aniversário, Sorteio de Número BR...)_`,
                cleared
            ),
            { parse_mode: 'HTML', reply_markup: kb2(Markup, [[{ text: '❌ Cancelar', callback_data: 'gw_create_cancel' }]]).reply_markup }
        );
    });


    bot.action('gw_create_cancel', async (ctx) => {
        await giveawayMode.delete(ctx.from.id);
        await ctx.answerCbQuery('Cancelado');
        const { txt, rows } = await buildGiveawaysPanel();
        await Msg.edit(ctx, txt, kb2(Markup, rows));
    });

    // Comando /addsorteio como atalho
    // email_broadcast — instrução para broadcast de email
    bot.action('email_broadcast', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        let emailCount = 0;
        try { emailCount = dbRaw().prepare("SELECT COUNT(*) as c FROM users WHERE email IS NOT NULL AND email_verified=1").get()?.c || 0; } catch { }
        await editAdminPanel(ctx,
            `${ADMIN_HTML.header('Broadcast Email')}\n\n👥 Destinatários: ${ADMIN_HTML.yellow(String(emailCount))} usuários\n\nComando:\n<code>/broadcast_email Assunto | Mensagem</code>`,
            kb2(Markup, [[{ text: '🔙 Voltar', callback_data: 'a_email' }]]));
    });
}

module.exports = { registerSupportHandlers };
