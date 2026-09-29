'use strict';

const { smmPanel } = require('./helpers/smmPanelUi');
const { isSmmEnabled } = require('./smmEnabled');
const { safeAnswerCbQuery } = require('../../utils/safeTelegram');

/** SMM_PUBLIC=0 restringe catálogo a admins (legado beta). Padrão: aberto a todos. */
function isSmmPublicAccess() {
    const v = String(process.env.SMM_PUBLIC ?? '1').toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'no';
}

function isSmmBetaAdminOnly() {
    return isSmmEnabled() && !isSmmPublicAccess();
}

function canUseSmmCatalog(uid, isAdminFn) {
    if (!isSmmEnabled()) return false;
    if (!isSmmBetaAdminOnly()) return true;
    return typeof isAdminFn === 'function' && isAdminFn(uid);
}

function smmMenuButtonLabel(uid, isAdminFn) {
    if (!isSmmEnabled()) return null;
    const { MENU_BTN } = require('../../telegram/menus/menuCopy');
    if (canUseSmmCatalog(uid, isAdminFn)) return MENU_BTN.smm;
    return MENU_BTN.smmBlocked;
}

async function replySmmDevBlocked(ctx, Msg) {
    await safeAnswerCbQuery(ctx, 'Indisponível no momento').catch(() => {});
    const html =
        '<b>Serviços SMM indisponíveis</b>\n\n' +
        'O catálogo de seguidores, curtidas e engajamento está temporariamente restrito.\n\n' +
        '<i>Tente novamente mais tarde ou fale com o suporte.</i>';
    return smmPanel(ctx, Msg, html, {
        inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu:home' }]],
    });
}

/**
 * @returns {boolean} true se pode continuar no fluxo SMM
 */
async function assertSmmCatalogAccess(ctx, Msg, isAdminFn) {
    if (canUseSmmCatalog(ctx.from?.id, isAdminFn)) return true;
    await replySmmDevBlocked(ctx, Msg);
    return false;
}

module.exports = {
    isSmmPublicAccess,
    isSmmBetaAdminOnly,
    canUseSmmCatalog,
    smmMenuButtonLabel,
    replySmmDevBlocked,
    assertSmmCatalogAccess,
};
