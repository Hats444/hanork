'use strict';

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


/** Helpers listagem destinos/grupos/canais */
function createDestinationHelpers(deps) {
    const {
        prisma, dbRaw, Markup, isAdmin, ADMIN_HTML, Msg, logger, groupService, editAdminPanel,
    } = pickAdminDeps(deps);

    async function showDestinationsHub(ctx) {
        if (!groupService) {
            return editAdminPanel(ctx, 'Módulo de destinos não carregado.', kb2(Markup, [[{ text: 'Voltar admin', callback_data: 'a_menu' }]]));
        }
        const stats = groupService.getStats();
        const txt = destinationsPanel.buildDestinationsHubMessage(stats);
        const kb = destinationsPanel.destinationsHubKeyboard();
        if (ctx.callbackQuery) await Msg.edit(ctx, txt, kb);
        else await editAdminPanel(ctx, txt, kb);
    }

    async function fetchBridgePanelContext(telegram) {
        try {
            const bridge = require('../../../services/TelegramUserBridge');
            const info = bridge.getAccountInfo ? await bridge.getAccountInfo() : { connected: false };
            let botTag = process.env.BOT_USERNAME || '';
            if (telegram) {
                try {
                    const me = await telegram.getMe();
                    botTag = me.username || botTag;
                } catch { /* ignore */ }
            }
            return { bridgeInfo: info, botTag, bridgeConnected: !!info?.connected };
        } catch {
            return { bridgeInfo: {}, botTag: process.env.BOT_USERNAME || '', bridgeConnected: false };
        }
    }

    async function showGroupsList(ctx, pageIndex = 0) {
        if (!groupService) {
            return editAdminPanel(ctx, 'Módulo de grupos não carregado.', kb2(Markup, [[{ text: 'Voltar admin', callback_data: 'a_menu' }]]));
        }
        const panel = await fetchBridgePanelContext(ctx.telegram);
        const { txt, totalPages, pageIndex: pi, rows } = destinationsPanel.buildGroupsListMessage(
            dbRaw(),
            groupService,
            pageIndex,
            { bridgeInfo: panel.bridgeInfo, botTag: panel.botTag }
        );
        const kb = destinationsPanel.groupsListKeyboard(pi, totalPages, rows, {
            bridgeConnected: panel.bridgeConnected,
        });
        if (ctx.callbackQuery) await Msg.edit(ctx, txt, kb);
        else await editAdminPanel(ctx, txt, kb);
    }

    async function showBridgeGroupsList(ctx, pageIndex = 0) {
        if (!groupService) {
            return editAdminPanel(ctx, 'Módulo não carregado.', kb2(Markup, [[{ text: 'Voltar admin', callback_data: 'a_menu' }]]));
        }
        const panel = await fetchBridgePanelContext(ctx.telegram);
        const { txt, totalPages, pageIndex: pi, rows } = destinationsPanel.buildBridgeGroupsListMessage(
            dbRaw(),
            groupService,
            pageIndex,
            { bridgeInfo: panel.bridgeInfo, botTag: panel.botTag }
        );
        const kb = destinationsPanel.bridgeGroupsListKeyboard(pi, totalPages, rows, {
            bridgeConnected: panel.bridgeConnected,
        });
        if (ctx.callbackQuery) await Msg.edit(ctx, txt, kb);
        else await editAdminPanel(ctx, txt, kb);
    }

    async function showChannelsList(ctx, pageIndex = 0) {
        if (!groupService) {
            return editAdminPanel(ctx, 'Módulo não carregado.', kb2(Markup, [[{ text: 'Voltar admin', callback_data: 'a_menu' }]]));
        }
        const { txt, totalPages, pageIndex: pi, rows } = destinationsPanel.buildChannelsListMessage(
            dbRaw(),
            groupService,
            pageIndex
        );
        const kb = destinationsPanel.channelsListKeyboard(pi, totalPages, rows);
        if (ctx.callbackQuery) await Msg.edit(ctx, txt, kb);
        else await editAdminPanel(ctx, txt, kb);
    }


    return { showDestinationsHub, showGroupsList, showBridgeGroupsList, showChannelsList };
}

module.exports = { createDestinationHelpers };
