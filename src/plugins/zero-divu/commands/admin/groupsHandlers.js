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


/** Destinos, grupos, canais, ponte — M4 */
function registerGroupsHandlers(bot, deps) {
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
        showDestinationsHub, showGroupsList, showBridgeGroupsList, showChannelsList,
    } = d;

    bot.action('a_destinos', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        try {
            await showDestinationsHub(ctx);
        } catch (e) {
            logger.error('a_destinos:', e.message);
            await Msg.replaceMenu(ctx, '❌ Erro ao carregar alcance.', kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
        }
    });

    bot.action('a_grupos', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        try {
            await showGroupsList(ctx, 0);
        } catch (e) {
            logger.error('a_grupos:', e.message);
            await Msg.replaceMenu(ctx, '❌ Erro ao carregar grupos.', kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
        }
    });

    bot.action(/^a_grupos_p_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        try {
            await showGroupsList(ctx, parseInt(ctx.match[1], 10));
        } catch (e) {
            logger.error('a_grupos_p:', e.message);
        }
    });

    bot.action('a_bridge_grupos', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        try {
            await showBridgeGroupsList(ctx, 0);
        } catch (e) {
            logger.error('a_bridge_grupos:', e.message);
            await Msg.replaceMenu(ctx, '❌ Erro ao carregar grupos ponte.', kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
        }
    });

    bot.action(/^a_bridge_grupos_p_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        try {
            await showBridgeGroupsList(ctx, parseInt(ctx.match[1], 10));
        } catch (e) {
            logger.error('a_bridge_grupos_p:', e.message);
        }
    });

    bot.action('a_entrar_help', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        await Msg.edit(
            ctx,
            `${ADMIN_HTML.header('Entrar em grupo')}\n\n` +
                `Envie no PV:\n` +
                `<code>/entrar @nome_do_grupo</code>\n` +
                `<code>/entrar https://t.me/+link</code>\n` +
                `<code>/entrar https://t.me/c/1234567890/191</code>\n\n` +
                `Links <code>t.me/c/…</code> são grupos privados — sua conta MTProto precisa estar neles.\n\n` +
                `Se o <b>bot não entrar</b>, sua conta MTProto entra e <b>permanece no grupo</b>. ` +
                `Só entra no pool automático se tiver 50+ membros e permissão de envio.\n\n` +
                `<i>1ª vez: /conectar (QR)</i>`,
            kb2(Markup, [
                [{ text: '📱 Grupos ponte', callback_data: 'a_bridge_grupos' }],
                [{ text: '👥 Todos grupos', callback_data: 'a_grupos' }],
                [{ text: '🔙 Admin', callback_data: 'a_menu' }],
            ])
        );
    });

    bot.action('bcast_bridge_now', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        const { guardDivulgacaoBusy } = require('../../../plugins/zero-divu/fullDivulgacao');
        if (guardDivulgacaoBusy(ctx, fullDivulgacaoDeps(deps))) return;
        await ctx.answerCbQuery('⏳ Divulgando via sua conta…');
        if (typeof runBridgePromoNow !== 'function') {
            return Msg.edit(ctx, '❌ Serviço ponte indisponível.', kb2(Markup, [[{ text: '🔙', callback_data: 'a_bridge_grupos' }]]));
        }
        try {
            const r = await runBridgePromoNow();
            if (r?.success === false) {
                const err =
                    r.error === 'already_running'
                        ? '⚠️ Já há divulgação em andamento.'
                        : r.error === 'bridge_unavailable'
                          ? '🔴 Ponte desconectada — use /conectar'
                          : `❌ ${r.error || 'Falhou'}`;
                return Msg.edit(ctx, err, kb2(Markup, [[{ text: '📱 Grupos ponte', callback_data: 'a_bridge_grupos' }]]));
            }
            const bp = r.bridgePromo || {};
            await Msg.edit(
                ctx,
                `✅ <b>Divulgação ponte OK</b>\n\n` +
                    (r.productName ? `📦 <b>${r.productName}</b>\n\n` : '') +
                    `📱 Alvos: <b>${bp.total || 0}</b>\n` +
                    `✏️ Editadas: ${bp.edited || 0} · 📤 Novas: ${bp.sent || 0} · ❌ ${bp.failed || 0}`,
                kb2(Markup, [[{ text: '📱 Grupos ponte', callback_data: 'a_bridge_grupos' }]])
            );
        } catch (e) {
            logger.error('[bcast_bridge_now]', e.message);
            await Msg.edit(ctx, `❌ ${e.message}`, kb2(Markup, [[{ text: '🔙', callback_data: 'a_bridge_grupos' }]]));
        }
    });

    bot.action('a_canais', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        try {
            await showChannelsList(ctx, 0);
        } catch (e) {
            logger.error('a_canais:', e.message);
            await Msg.replaceMenu(ctx, '❌ Erro ao carregar canais.', kb2(Markup, [[{ text: '🔙 Admin', callback_data: 'a_menu' }]]));
        }
    });

    bot.action(/^a_canais_p_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        try {
            await showChannelsList(ctx, parseInt(ctx.match[1], 10));
        } catch (e) {
            logger.error('a_canais_p:', e.message);
        }
    });
}

module.exports = { registerGroupsHandlers };
