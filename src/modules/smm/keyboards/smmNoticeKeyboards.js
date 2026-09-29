'use strict';

const { Markup } = require('telegraf');
const { CB } = require('../utils/smmCallbackData');
const L = require('../utils/smmLabels');

function checkoutNoticeKeyboard(error, serviceId) {
    const sid = Number(serviceId);
    const rows = [];

    if (
        error === 'duplicate_order' ||
        error === 'link_invalid' ||
        error === 'link_platform_mismatch'
    ) {
        rows.push([
            { text: L.CHANGE_LINK, callback_data: CB.wizardLink(sid) },
            { text: L.CHANGE_QTY, callback_data: CB.wizardQty(sid) },
        ]);
    } else if (
        error === 'quantity_invalid' ||
        error === 'quantity_below_min' ||
        error === 'quantity_above_max' ||
        error === 'payment_below_minimum'
    ) {
        rows.push([
            { text: L.OTHER_QTY, callback_data: CB.wizardQty(sid) },
            { text: L.CHANGE_LINK, callback_data: CB.wizardLink(sid) },
        ]);
    }

    if (sid) {
        rows.push([
            { text: L.CHANGE_SERVICE, callback_data: CB.view(sid) },
            { text: L.CATALOG, callback_data: CB.HOME },
        ]);
    } else {
        rows.push([{ text: L.HOME, callback_data: CB.HOME }]);
    }
    rows.push([{ text: L.CANCEL_ORDER, callback_data: CB.cancelWizard }]);
    return Markup.inlineKeyboard(rows);
}

function wizardLinkNoticeKeyboard(serviceId) {
    const sid = Number(serviceId);
    return Markup.inlineKeyboard([
        [
            { text: L.CHANGE_SERVICE, callback_data: CB.view(sid) },
            { text: L.CATALOG, callback_data: CB.HOME },
        ],
        [{ text: L.CANCEL, callback_data: CB.cancelWizard }],
    ]);
}

function wizardQuantityNoticeKeyboard(serviceId) {
    const sid = Number(serviceId);
    return Markup.inlineKeyboard([
        [{ text: L.OTHER_QTY, callback_data: CB.wizardQty(sid) }],
        [
            { text: L.CHANGE_LINK, callback_data: CB.wizardLink(sid) },
            { text: L.SERVICE, callback_data: CB.view(sid) },
        ],
        [{ text: L.CATALOG, callback_data: CB.HOME }, { text: L.CANCEL, callback_data: CB.cancelWizard }],
    ]);
}

function cooldownNoticeKeyboard() {
    return Markup.inlineKeyboard([
        [{ text: L.HOME, callback_data: CB.HOME }],
        [{ text: L.MENU, callback_data: 'menu:home' }],
    ]);
}

function genericNoticeKeyboard(serviceId = null) {
    const row = [{ text: L.HOME, callback_data: CB.HOME }];
    if (serviceId) {
        return Markup.inlineKeyboard([
            [{ text: L.SERVICE, callback_data: CB.view(serviceId) }, row[0]],
            [{ text: L.MENU, callback_data: 'menu:home' }],
        ]);
    }
    return Markup.inlineKeyboard([row, [{ text: L.MENU, callback_data: 'menu:home' }]]);
}

function actionNoticeKeyboard(orderId = null) {
    const rows = [];
    if (orderId) {
        rows.push([{ text: L.BACK_ORDER, callback_data: CB.orderView(orderId) }]);
    }
    rows.push(
        [{ text: L.HOME, callback_data: CB.HOME }],
        [{ text: L.MENU, callback_data: 'menu:home' }]
    );
    return Markup.inlineKeyboard(rows);
}

function catalogNoticeKeyboard() {
    return Markup.inlineKeyboard([
        [{ text: L.HOME, callback_data: CB.HOME }],
        [{ text: L.TERMS, callback_data: 'terms:summary' }],
        [{ text: L.MENU, callback_data: 'menu:home' }],
    ]);
}

function fulfillFailureNoticeKeyboard(smmOrderId, serviceId = null) {
    return orderIssueNoticeKeyboard(smmOrderId, serviceId);
}

function fulfillSuccessNoticeKeyboard(smmOrderId) {
    const rows = [
        [
            { text: L.TRACK_ORDER, callback_data: CB.orderView(smmOrderId) },
            { text: L.MY_ORDERS, callback_data: CB.orders },
        ],
        [{ text: L.NEW_ORDER, callback_data: CB.HOME }],
        [{ text: L.MENU, callback_data: 'menu:home' }],
    ];
    return Markup.inlineKeyboard(rows);
}

function orderStatusNoticeKeyboard(smmOrderId) {
    return orderIssueNoticeKeyboard(smmOrderId);
}

function orderIssueNoticeKeyboard(smmOrderId, serviceId = null) {
    const rows = [];
    if (smmOrderId) {
        rows.push([
            { text: L.VIEW_ORDER, callback_data: CB.orderView(smmOrderId) },
            { text: L.MY_ORDERS, callback_data: CB.orders },
        ]);
    }
    rows.push([{ text: L.TICKET, callback_data: 'hanork:ticket' }]);
    const nav = [{ text: L.NEW_ORDER, callback_data: CB.HOME }];
    if (serviceId) {
        nav.push({ text: L.OTHER_SERVICE, callback_data: CB.view(serviceId) });
    }
    rows.push(nav);
    rows.push([{ text: L.MENU, callback_data: 'menu:home' }]);
    return Markup.inlineKeyboard(rows);
}

module.exports = {
    checkoutNoticeKeyboard,
    wizardLinkNoticeKeyboard,
    wizardQuantityNoticeKeyboard,
    cooldownNoticeKeyboard,
    genericNoticeKeyboard,
    actionNoticeKeyboard,
    catalogNoticeKeyboard,
    fulfillFailureNoticeKeyboard,
    fulfillSuccessNoticeKeyboard,
    orderStatusNoticeKeyboard,
    orderIssueNoticeKeyboard,
};
