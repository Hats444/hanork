'use strict';

const { Markup } = require('telegraf');
const { CB } = require('./callbacks/constants');
const { CB: SMM_CB } = require('../modules/smm/utils/smmCallbackData');

const NAV = {
    BACK: '🔙 Voltar',
    HOME: '🏠 Menu',
    REFRESH: '🔄 Atualizar',
    CLOSE: '❌ Fechar',
    ORDERS: '📦 Meus Pedidos',
    SUPPORT: '🎫 Suporte',
    WALLET: '💰 Carteira',
    CASHBACK: '🎁 Cashback',
    AFFILIATE: '🤝 Afiliados',
    TERMS: '📜 Termos',
    CATALOG: '🛍️ Catálogo',
    SMM: '📈 Serviços SMM',
};

function navRow(items = []) {
    const row = [];
    for (const item of items) {
        if (!item) continue;
        if (typeof item === 'object' && item.text && item.callback_data) {
            row.push(item);
        }
    }
    return row.length ? row : null;
}

function backBtn(callbackData) {
    return { text: NAV.BACK, callback_data: callbackData };
}

function homeBtn(callbackData = CB.MENU_HOME) {
    return { text: NAV.HOME, callback_data: callbackData };
}

function smmHomeBtn() {
    return { text: NAV.SMM, callback_data: SMM_CB.HOME };
}

function ordersBtn(callbackData = SMM_CB.orders) {
    return { text: NAV.ORDERS, callback_data: callbackData };
}

function supportBtn(callbackData = 'hanork:ticket') {
    return { text: NAV.SUPPORT, callback_data: callbackData };
}

function termsBtn(callbackData = 'terms:open:0') {
    return { text: NAV.TERMS, callback_data: callbackData };
}

/**
 * Anexa linhas de navegação padrão ao teclado existente.
 * @param {Array<Array>} rows — inline_keyboard rows
 * @param {object} opts
 */
function appendNav(rows, opts = {}) {
    const out = Array.isArray(rows) ? rows.map((r) => [...r]) : [];
    const nav = [];

    if (opts.back) nav.push(backBtn(opts.back));
    if (opts.refresh) nav.push({ text: NAV.REFRESH, callback_data: opts.refresh });
    if (opts.close) nav.push({ text: NAV.CLOSE, callback_data: opts.close });

    const navLine = navRow(nav);
    if (navLine) out.push(navLine);

    const bottom = [];
    if (opts.orders) bottom.push(ordersBtn(opts.orders));
    if (opts.support) bottom.push(supportBtn(opts.support));
    if (opts.home !== false) {
        bottom.push(homeBtn(opts.home || CB.MENU_HOME));
    }

    const bottomLine = navRow(bottom);
    if (bottomLine) out.push(bottomLine);

    return out;
}

function navKeyboard(opts = {}) {
    return Markup.inlineKeyboard(appendNav([], opts));
}

function mergeKeyboard(existingMarkup, navOpts = {}) {
    const km = existingMarkup?.reply_markup || existingMarkup;
    const rows = km?.inline_keyboard ? [...km.inline_keyboard] : [];
    return Markup.inlineKeyboard(appendNav(rows, navOpts));
}

module.exports = {
    NAV,
    navRow,
    backBtn,
    homeBtn,
    smmHomeBtn,
    ordersBtn,
    supportBtn,
    termsBtn,
    appendNav,
    navKeyboard,
    mergeKeyboard,
};
