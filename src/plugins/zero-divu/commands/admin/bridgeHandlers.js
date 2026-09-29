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
const { JoinChatService, extractJoinTargets } = require('../../../services/JoinChatService');
const { deferBackground } = require('../../../utils/defer');


/** conectar, ponte, entrar — M4 */
function registerBridgeHandlers(bot, deps) {
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

    bot.command('conectar', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const { connectBridge } = require('../../../services/BridgeAutoService');
        try {
            const r = await connectBridge(ctx, dbRaw, { groupService });
            if (!r.ok && r.message) await Msg.reply(ctx, r.message);
        } catch (e) {
            logger.error('[conectar]', e.message);
            await Msg.reply(ctx, `❌ ${e.message}`);
        }
    });

    bot.command('ponte', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const bridge = require('../../../services/TelegramUserBridge');
        const st = groupService?.getStats?.() || {};
        if (bridge.isConfigured()) {
            const info = bridge.getAccountInfo ? await bridge.getAccountInfo() : { connected: true };
            const who = [];
            if (info.phoneMasked) who.push(info.phoneMasked);
            if (info.username) who.push(`@${info.username}`);
            else if (info.displayName) who.push(info.displayName);
            const line = who.length ? who.join(' · ') : 'Conta conectada';
            return Msg.reply(
                ctx,
                '✅ <b>Ponte MTProto ativa</b>\n\n' +
                    `📱 <b>Sua conta:</b> ${line}\n` +
                    `👥 Grupos ponte: <b>${st.bridgePromo ?? 0}</b>\n\n` +
                    `Use <code>/entrar @grupo</code> — se o bot não entrar, divulga pelo seu número.\n\n` +
                    `Admin → <b>Grupos</b> → <b>📱 Grupos do meu número</b>\n\n` +
                    '<i>Reconectar: apague TELEGRAM_USER_SESSION no .env e /conectar.</i>',
                { parse_mode: 'HTML' }
            );
        }
        const { connectBridge } = require('../../../services/BridgeAutoService');
        await connectBridge(ctx, dbRaw, { groupService });
    });

    bot.action('bridge:ponte', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const { connectBridge } = require('../../../services/BridgeAutoService');
        await connectBridge(ctx, dbRaw, { groupService });
    });

    bot.command('entrar', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const raw = (ctx.message.text || '').trim();
        const argText = raw.replace(/^\/entrar(@\w+)?\s*/i, '').trim();
        const replyText = ctx.message.reply_to_message?.text || ctx.message.reply_to_message?.caption || '';
        const combined = [argText, replyText].filter(Boolean).join('\n');

        if (!combined) {
            const cleared = botSession ? await botSession.enterAdminFlow(ctx, 'joinChat') : {};
            joinChatAwaiting?.add(ctx.from.id);
            return Msg.reply(
                ctx,
                appendSessionDiscardedNote(
                    '🔗 <b>Entrar em grupo ou canal</b>\n\n' +
                    '• Link <code>+</code> (privado): <code>/entrar https://t.me/+XXX</code>\n' +
                    '• @nome ou link público: <code>/entrar @grupo</code>\n' +
                    '• ID: <code>/entrar -1001234567890</code>\n\n' +
                    '<i>1ª vez em link +: <code>/conectar</code> (QR no celular).</i>\n\n' +
                    '/cancelar para sair.',
                    cleared
                ),
                kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]])
            );
        }

        joinChatAwaiting?.delete(ctx.from.id);

        if (entrarNeedsBridge(combined)) {
            const { connectBridge } = require('../../../services/BridgeAutoService');
            const firstLink = extractJoinTargets(combined)[0] || combined.split(/\s/)[0];
            const chatId = ctx.chat.id;
            const telegram = ctx.telegram;
            await Msg.reply(
                ctx,
                `🔗 <b>Link +</b>\n<code>${firstLink}</code>\n\n⏳ Preparando conexão…`,
                { parse_mode: 'HTML' }
            );
            deferBackground('entrar-bridge', async () => {
                try {
                    await connectBridge(ctx, dbRaw, { pendingLink: combined, groupService });
                } catch (e) {
                    logger.error('[entrar] bridge:', e.message);
                    await telegram.sendMessage(chatId, `❌ ${e.message}`, { parse_mode: 'HTML' });
                }
            });
            return;
        }

        const chatId = ctx.chat.id;
        const telegram = ctx.telegram;
        deferBackground('entrar-join', async () => {
            try {
                await telegram.sendMessage(chatId, '⏳ Tentando entrar via ponte MTProto…', {
                    parse_mode: 'HTML',
                });
                const joiner = new JoinChatService(telegram, groupService);
                const batch = await joiner.joinFromText(combined);
                const summary = JoinChatService.formatSummary(batch);
                await telegram.sendMessage(chatId, summary.text, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: JoinChatService.getReplyKeyboardRows(summary),
                    },
                });
            } catch (e) {
                logger.error('[entrar]', e.message);
                await telegram.sendMessage(chatId, `❌ Erro: ${e.message}`, { parse_mode: 'HTML' });
            }
        });
    });

    // Handler para comando /restock ID QUANTIDADE
    bot.command('restock', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const parts = ctx.message.text.split(' ').slice(1);
        const pid = parseInt(parts[0]);
        const qtd = parseInt(parts[1]) || 0;
        
        if (!pid || qtd <= 0) {
            return Msg.reply(ctx, '❌ Uso: <code>/restock ID_PRODUTO QUANTIDADE</code>\n\nExemplo: <code>/restock 15 100</code>', { parse_mode: 'HTML' });
        }
        
        try {
            const db = dbRaw();
            const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
            if (!prod) return Msg.reply(ctx, '❌ Produto não encontrado.');
            
            const oldStock = prod.stock;
            db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(qtd, pid);
            
            // Buscar usuários que querem ser notificados
            const waiting = db.prepare(
                'SELECT rn.*, u.telegram_id FROM restock_notify rn JOIN users u ON u.id = rn.user_id WHERE rn.product_id = ? AND rn.notified = 0'
            ).all(pid);
            
            let notifMsg = '';
            if (waiting.length && oldStock === 0) {
                // Notificar usuários
                let sent = 0;
                for (const w of waiting) {
                    try {
                        await bot.telegram.sendMessage(parseInt(w.telegram_id),
                            `🎉 <b>Produto Disponível!</b>\n\n` +
                            `📦 <b>${prod.name}</b> está de volta ao estoque!\n` +
                            `📊 Quantidade: ${qtd} unidades\n\n` +
                            `👇 Clique abaixo para comprar:`,
                            {
                                parse_mode: 'HTML',
                                reply_markup: kb2(Markup, [
                                    [{ text: '🛒 Ver Produto', callback_data: `p_${pid}` }],
                                    [{ text: '🏠 Menu', callback_data: 'home' }]
                                ]).reply_markup
                            }
                        );
                        sent++;
                    } catch (e) { /* ignore */ }
                }
                
                // Limpar notificações
                db.prepare('DELETE FROM restock_notify WHERE product_id = ?').run(pid);
                notifMsg = `\n🔔 ${sent} usuário(s) notificado(s) do restock.`;
            }
            
            await Msg.reply(ctx, 
                `✅ <b>Restock Realizado!</b>\n\n` +
                `📦 <b>${prod.name}</b>\n` +
                `📊 Estoque: ${oldStock} → <b>${qtd}</b>${notifMsg}`,
                { parse_mode: 'HTML', reply_markup: kb2(Markup, [[{ text: '📦 Ver Restock', callback_data: 'a_restock' }], [{ text: '🔙 Admin', callback_data: 'a_menu' }]]).reply_markup }
            );
        } catch (e) {
            logger.error('/restock error:', e.message);
            await Msg.reply(ctx, '❌ Erro: ' + e.message);
        }
    });
}

module.exports = { registerBridgeHandlers };
