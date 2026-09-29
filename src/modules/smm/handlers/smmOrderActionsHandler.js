'use strict';

const { Markup } = require('telegraf');
const SmmOrderService = require('../services/orderService');
const SmmServiceRepository = require('../repositories/smmServiceRepository');
const { canRequestRefill, canRequestCancel } = require('../validators/smmActionValidator');
const { actionErrorMessage, serviceFlag } = require('../validators/smmActionValidator');
const { formatOrderLine, formatOrderStatus, formatMoney } = require('../utils/smmTextFormat');
const { CB } = require('../utils/smmCallbackData');
const { smmPanel } = require('../helpers/smmPanelUi');
const { actionNoticeKeyboard, catalogNoticeKeyboard } = require('../keyboards/smmNoticeKeyboards');
const L = require('../utils/smmLabels');

async function sendUserOrders(ctx, Msg, telegramId) {
    const orders = SmmOrderService.listUserOrders(telegramId, 10);
    if (!orders.length) {
        return smmPanel(ctx, Msg, 'Você ainda não tem pedidos SMM.', {
            inline_keyboard: [[{ text: L.BUY_SERVICES, callback_data: CB.HOME }]],
        });
    }

    const lines = ['<b>Seus pedidos SMM</b>\n'];
    const rows = [];

    for (const o of orders.slice(0, 8)) {
        const svc = SmmServiceRepository.findById(o.service_id);
        lines.push(formatOrderLine(o, svc?.name));
        rows.push([{ text: `#${o.id}`, callback_data: CB.orderView(o.id) }]);
    }

    rows.push([{ text: L.NEW_ORDER, callback_data: CB.HOME }]);

    return smmPanel(ctx, Msg, lines.join('\n\n'), Markup.inlineKeyboard(rows));
}

async function sendOrderDetail(ctx, Msg, orderId, telegramId) {
    const order = SmmOrderService.findById(orderId);
    if (!order || String(order.telegram_id) !== String(telegramId)) {
        return smmPanel(ctx, Msg, actionErrorMessage('order_not_found'), catalogNoticeKeyboard());
    }

    const svc = SmmServiceRepository.findById(order.service_id);
    const rows = [];

    const refillOk = canRequestRefill(order, svc).ok;
    const cancelOk = canRequestCancel(order, svc).ok;

    if (refillOk) {
        rows.push([{ text: L.REFILL, callback_data: CB.refill(orderId) }]);
    }
    if (cancelOk) {
        rows.push([{ text: L.CANCEL_ORDER, callback_data: CB.cancelAsk(orderId) }]);
    }

    rows.push(
        [{ text: L.MY_ORDERS, callback_data: CB.orders }],
        [{ text: L.HOME, callback_data: CB.HOME }]
    );

    const flags = [];
    if (serviceFlag(svc?.refill)) flags.push('Reposição');
    if (serviceFlag(svc?.cancel)) flags.push('Cancelável');

    const text =
        `<b>Pedido #${order.id}</b>\n\n` +
        `Status: <b>${formatOrderStatus(order.status)}</b>\n` +
        `Serviço: <i>${svc?.name?.slice(0, 80) || 'n/d'}</i>\n` +
        `Qtd: <b>${Number(order.quantity).toLocaleString('pt-BR')}</b>\n` +
        `Total: <b>${formatMoney(order.sale_price)}</b>\n` +
        (flags.length ? `\n<i>${flags.join(' · ')}</i>` : '');

    return smmPanel(ctx, Msg, text, Markup.inlineKeyboard(rows), { screen: 'orders' });
}

module.exports = {
    sendUserOrders,
    sendOrderDetail,
};
