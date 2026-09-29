'use strict';

const AffiliateCore = require('../../../modules/affiliate/AffiliateCore');
const AffiliatePanels = require('../../../modules/affiliate/AffiliatePanels');

function registerSupportCommands(bot, deps) {
    const {
        isAdmin,
        prisma,
        Msg,
        Markup,
        replyWithMenuPhoto,
        botSession,
        sessionNote,
        Menu,
        isGroupChat,
        groupGuard,
        bot: telegramBot,
        hanorkAssistantApi,
        campanhaEmailMode,
        supportMode,
        hanorkAssistMode,
        broadcastMode,
        productWizard,
        editProductMode,
        joinChatAwaiting,
        giveawayMode,
        adminMsgTarget,
        catalogSearchMode,
        onboardingStep,
    } = deps;

    bot.command('cancelar', async (ctx) => {
        const { getBridgeLoginService } = require('../../../services/BridgeLoginService');
        const bridgeLogin = getBridgeLoginService(deps.dbRaw);
        let wadvCleared = false;
        try {
            const { getWaDivulgacaoCampaignService } = require('../../../modules/wa-divulgacao/waDivulgacaoCampaignService');
            const { getWaDivulgacaoLoginService } = require('../../../modules/wa-divulgacao/waDivulgacaoLoginService');
            const camp = getWaDivulgacaoCampaignService();
            const login = getWaDivulgacaoLoginService();
            if (camp.hasActiveSession(ctx.from.id)) {
                camp.clearSession(ctx.from.id);
                wadvCleared = true;
            }
            if (login.isAwaitingPhone(ctx.from.id)) {
                await login.cancel(ctx.from.id);
                wadvCleared = true;
            }
        } catch {
            /* optional */
        }
        if (isAdmin(ctx.from.id) && bridgeLogin.isAwaiting(ctx.from.id)) {
            await bridgeLogin.cancel(ctx.from.id);
        }
        const ActiveModesService = require('../../../services/ActiveModesService');
        const activeBefore = await ActiveModesService.collectActiveModes(ctx, {
            campanhaEmailMode,
            supportMode,
            hanorkAssistMode,
            broadcastMode,
            productWizard,
            editProductMode,
            joinChatAwaiting,
            giveawayMode,
            adminMsgTarget,
            catalogSearchMode,
            onboardingStep,
            bridgeLogin,
            isAdmin,
        });
        const sessionCleared = await botSession.clearForCancel(ctx);
        const cleared = Object.keys(sessionCleared).length > 0 || wadvCleared;
        const msg = sessionNote(
            wadvCleared && !Object.keys(sessionCleared).length
                ? '❌ Hanork Div: campanha/conexão cancelada.'
                : ActiveModesService.buildCancelReply(cleared, cleared ? [] : activeBefore),
            sessionCleared
        );
        return replyWithMenuPhoto(ctx, msg, Menu.principal());
    });

    bot.command('suporte', async (ctx) => {
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        return hanorkAssistantApi.openHanorkAssistant(ctx, { fromCommand: true });
    });

    bot.command('tickets', async (ctx) => {
        if (!isAdmin(ctx.from.id)) {
            const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
            if (!user) return replyWithMenuPhoto(ctx, '❌ Faça /start primeiro.');
            const mine = await prisma.ticket.findByUser(user.id);
            if (!mine.length) {
                return replyWithMenuPhoto(
                    ctx,
                    '🎫 Você não tem tickets.\n\nUse /suporte para abrir um.',
                    Markup.inlineKeyboard([[{ text: '🎫 Abrir Suporte', callback_data: 'suporte_start' }]])
                );
            }
            let txt = `<b>🎫 Seus Tickets</b>\n\n`;
            mine.forEach((t) => {
                const st = t.status === 'open' ? '🟢 Aberto' : '⚪ Encerrado';
                txt += `<b>#${t.id}</b> ${st}\n${(t.message || '').slice(0, 80)}\n\n`;
            });
            return Msg.sendLongHtml(ctx, txt, Markup.inlineKeyboard([[{ text: '🎫 Novo ticket', callback_data: 'suporte_start' }]]));
        }
        const open = await prisma.ticket.findOpen();
        if (!open.length) {
            return Msg.reply(
                ctx,
                '✅ Nenhum ticket aberto.',
                Markup.inlineKeyboard([[{ text: '🔙 Admin', callback_data: 'a_menu' }]])
            );
        }
        let txt = `<b>🎫 Tickets Abertos (${open.length})</b>\n\n`;
        open.slice(0, 20).forEach((t) => {
            txt += `<b>#${t.id}</b> <code>${t.telegram_id}</code> ${t.status === 'open' ? '🟢' : '⚪'}\n${t.message.slice(0, 60)}${t.message.length > 60 ? '...' : ''}\n\n`;
        });
        const btns = open.slice(0, 8).map((t) => [
            { text: `#${t.id} — ${t.message.slice(0, 28)}`, callback_data: `ticket_${t.id}` },
        ]);
        btns.push([{ text: '🔙 Admin', callback_data: 'a_menu' }]);
        await Msg.sendLongHtml(ctx, txt, Markup.inlineKeyboard(btns), { editFirst: !!ctx.callbackQuery });
    });

    bot.command('rastrear', async (ctx) => {
        const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        if (!user) return Msg.reply(ctx, '❌ Faça /start primeiro.');
        const arg = ctx.message.text.split(' ')[1];
        let orders;
        if (arg) {
            const all = await prisma.order.findMany({ where: { user_id: user.id } });
            orders = all.filter((o) => o.id.includes(arg) || o.id.slice(-8).includes(arg));
        } else {
            orders = (await prisma.order.findMany({ where: { user_id: user.id } }))
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 5);
        }
        if (!orders.length) {
            return Msg.reply(
                ctx,
                '📦 Nenhum pedido encontrado.\n\nUse `/rastrear ID` com os últimos dígitos do seu pedido.',
                { parse_mode: 'HTML' }
            );
        }
        const OrderTrackingService = require('../../../services/OrderTrackingService');
        const txt = await OrderTrackingService.buildTrackingText(orders, { max: orders.length });
        const kb = await OrderTrackingService.buildTrackingKeyboard(orders);
        await Msg.sendLongHtml(ctx, txt, kb, { forceNew: true });
    });

    bot.command('compartilhar', async (ctx) => {
        const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        if (!user) return replyWithMenuPhoto(ctx, '❌ Faça /start primeiro.');
        const aff = await AffiliateCore.ensureAffiliate(user.id, ctx.from.id);
        const botInfo = telegramBot.botInfo || (await telegramBot.telegram.getMe());
        const link = AffiliateCore.affiliateStartLink(botInfo.username, aff.code);
        const txt = AffiliatePanels.buildSharePanelText(aff, botInfo.username);
        await replyWithMenuPhoto(ctx, txt, AffiliatePanels.shareKeyboard(link));
    });

    bot.action('ver_afiliado', async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        if (!user) return Msg.edit(ctx, '❌ Faça /start primeiro.');
        const aff = await AffiliateCore.ensureAffiliate(user.id, ctx.from.id);
        const botInfo = telegramBot.botInfo || (await telegramBot.telegram.getMe());
        await Msg.edit(
            ctx,
            AffiliatePanels.buildAffiliatePanelText(aff, botInfo.username),
            AffiliatePanels.affiliatePanelKeyboard(false)
        );
    });

    bot.command('reenviar', async (ctx) => {
        const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        if (!user) return Msg.reply(ctx, '❌ Faça /start primeiro.');
        const orders = (await prisma.order.findMany({ where: { user_id: user.id } }))
            .filter((o) => o.status === 'DELIVERED')
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 5);
        if (!orders.length) return Msg.reply(ctx, '📦 Você não tem pedidos entregues ainda.');
        const ResendService = require('../../../services/ResendService');
        await Msg.reply(ctx, ResendService.LIST_TEXT, ResendService.buildResendListKeyboard(orders), { forceNew: true });
    });

    bot.action('suporte_start', async (ctx) => hanorkAssistantApi.openHanorkAssistant(ctx));
    bot.action('suporte_btn', async (ctx) => hanorkAssistantApi.openHanorkAssistant(ctx));
}

module.exports = { registerSupportCommands };
