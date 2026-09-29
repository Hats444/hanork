'use strict';

const { virtuoPanel } = require('./helpers/virtuoPanelUi');
const { isVirtuoEnabled } = require('./virtuoEnabled');
const VirtuoConfig = require('./virtuoConfig');
const { safeAnswerCbQuery } = require('../../utils/safeTelegram');

function isVirtuoPublicAccess() {
    return VirtuoConfig.publicAccess;
}

function canUseVirtuoCatalog(uid, isAdminFn) {
    if (!isVirtuoEnabled()) return false;
    if (isVirtuoPublicAccess()) return true;
    return typeof isAdminFn === 'function' && isAdminFn(uid);
}

function virtuoMenuButtonLabel(uid, isAdminFn) {
    const { MENU_BTN } = require('../../telegram/menus/menuCopy');
    if (!isVirtuoEnabled()) return MENU_BTN.virtuo;
    if (canUseVirtuoCatalog(uid, isAdminFn)) return MENU_BTN.virtuo;
    return MENU_BTN.virtuoBlocked;
}

async function replyVirtuoDevBlocked(ctx, Msg) {
    await safeAnswerCbQuery(ctx, 'Indisponível no momento').catch(() => {});
    const html =
        '<b>Números SMS indisponíveis</b>\n\n' +
        'O serviço de números virtuais está temporariamente restrito.\n\n' +
        '<i>Tente novamente mais tarde ou fale com o suporte.</i>';
    return virtuoPanel(ctx, Msg, html, {
        inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu:home' }]],
    });
}

async function assertVirtuoCatalogAccess(ctx, Msg, isAdminFn) {
    if (canUseVirtuoCatalog(ctx.from?.id, isAdminFn)) return true;
    await replyVirtuoDevBlocked(ctx, Msg);
    return false;
}

module.exports = {
    isVirtuoPublicAccess,
    canUseVirtuoCatalog,
    virtuoMenuButtonLabel,
    replyVirtuoDevBlocked,
    assertVirtuoCatalogAccess,
};
