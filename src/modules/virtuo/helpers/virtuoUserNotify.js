'use strict';

const { Markup } = require('telegraf');
const { escapeTelegramHtml } = require('../../../telegram/htmlEscape');
const { CB: MENU_CB } = require('../../../telegram/callbacks/constants');
const { CB } = require('../utils/virtuoCallbackData');
const L = require('../utils/virtuoLabels');
const { upsertOrderPanel, clearTrack } = require('./virtuoOrderPanel');

function orderRef(orderId) {
    return String(orderId || '').slice(-8);
}

function waitingKeyboard(virtuoOrderId) {
    return Markup.inlineKeyboard([
        [{ text: '📋 Copiar número', callback_data: CB.orderCopyPhone(virtuoOrderId) }],
        [
            { text: '🔄 Atualizar', callback_data: CB.orderRefresh(virtuoOrderId) },
            { text: L.HOME, callback_data: CB.HOME },
        ],
        [{ text: L.MENU, callback_data: MENU_CB.MENU_HOME }],
    ]);
}

function completedKeyboard(virtuoOrderId) {
    return Markup.inlineKeyboard([
        [{ text: '📋 Copiar código', callback_data: CB.orderCopyCode(virtuoOrderId) }],
        [
            { text: L.HOME, callback_data: CB.HOME },
            { text: L.MY_ORDERS, callback_data: CB.orders },
        ],
        [{ text: L.MENU, callback_data: MENU_CB.MENU_HOME }],
    ]);
}

function reservingKeyboard() {
    return Markup.inlineKeyboard([[{ text: L.MENU, callback_data: MENU_CB.MENU_HOME }]]);
}

function failedKeyboard() {
    return Markup.inlineKeyboard([
        [{ text: L.HOME, callback_data: CB.HOME }],
        [{ text: L.MENU, callback_data: MENU_CB.MENU_HOME }],
    ]);
}

async function notifyPaymentApproved(bot, { orderId, virtuoOrderId, telegramId, serviceName, countryName }) {
    const text =
        `<b>✅ Pagamento confirmado</b>\n\n` +
        `<b>${escapeTelegramHtml(serviceName)}</b> · ${escapeTelegramHtml(countryName)}\n` +
        `Pedido <code>#${orderRef(orderId)}</code>\n\n` +
        `<i>⏳ Reservando seu número virtual…</i>`;
    return upsertOrderPanel(bot, telegramId, orderId, text, reservingKeyboard(), 'virtuo');
}

async function notifyPhoneAssigned(bot, { orderId, virtuoOrderId, telegramId, phone, serviceName, countryName }) {
    const text =
        `<b>📱 Número virtual</b>\n\n` +
        `<b>${escapeTelegramHtml(serviceName)}</b> · ${escapeTelegramHtml(countryName)}\n` +
        `Pedido <code>#${orderRef(orderId)}</code>\n\n` +
        `📞 <code>${escapeTelegramHtml(phone)}</code>\n\n` +
        `<i>Cole no app e aguarde o SMS (até 30 min).</i>\n` +
        `<i>Esta mensagem será atualizada quando o código chegar.</i>`;
    return upsertOrderPanel(
        bot,
        telegramId,
        orderId,
        text,
        waitingKeyboard(virtuoOrderId),
        'virtuo'
    );
}

async function notifySmsReceived(bot, { orderId, virtuoOrderId, telegramId, phone, code, serviceName, countryName }) {
    const text =
        `<b>✅ Código SMS recebido</b>\n\n` +
        `<b>${escapeTelegramHtml(serviceName)}</b>` +
        (countryName ? ` · ${escapeTelegramHtml(countryName)}` : '') +
        `\nPedido <code>#${orderRef(orderId)}</code>\n\n` +
        `📞 <code>${escapeTelegramHtml(phone)}</code>\n` +
        `🔢 <code>${escapeTelegramHtml(code)}</code>\n\n` +
        `<i>Use no app e conclua a verificação.</i>`;
    return upsertOrderPanel(
        bot,
        telegramId,
        orderId,
        text,
        completedKeyboard(virtuoOrderId),
        'virtuo'
    );
}

async function notifyOrderFailed(bot, { orderId, telegramId, reason, detail }) {
    if (orderId) clearTrack(orderId);
    const text =
        `<b>❌ Não foi possível concluir</b>\n\n` +
        (orderId ? `Pedido <code>#${orderRef(orderId)}</code>\n` : '') +
        `${escapeTelegramHtml(detail || reason || 'Tente novamente ou fale com o suporte.')}\n\n` +
        `<i>Se o pagamento foi aprovado, nossa equipe pode ajudar.</i>`;
    return upsertOrderPanel(bot, telegramId, orderId, text, failedKeyboard(), 'virtuo');
}

/** Re-renderiza painel conforme status atual (callback Atualizar). */
async function refreshOrderPanel(bot, order) {
    if (!order?.hanork_order_id) return false;
    const ref = orderRef(order.hanork_order_id);
    const phone = order.phone || '—';
    const svc = order.service_name || 'SMS';
    const cty = order.country_name || '';

    if (order.status === 'completed' && order.sms_code) {
        return notifySmsReceived(bot, {
            orderId: order.hanork_order_id,
            virtuoOrderId: order.id,
            telegramId: order.telegram_id,
            phone,
            code: order.sms_code,
            serviceName: svc,
            countryName: cty,
        });
    }

    if (order.phone) {
        return notifyPhoneAssigned(bot, {
            orderId: order.hanork_order_id,
            virtuoOrderId: order.id,
            telegramId: order.telegram_id,
            phone,
            serviceName: svc,
            countryName: cty,
        });
    }

    return notifyPaymentApproved(bot, {
        orderId: order.hanork_order_id,
        virtuoOrderId: order.id,
        telegramId: order.telegram_id,
        serviceName: svc,
        countryName: cty,
    });
}

module.exports = {
    notifyPaymentApproved,
    notifyPhoneAssigned,
    notifySmsReceived,
    notifyOrderFailed,
    refreshOrderPanel,
    waitingKeyboard,
    completedKeyboard,
};
