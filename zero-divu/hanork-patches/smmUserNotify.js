'use strict';

const { Markup } = require('telegraf');
const logger = require('../../../config/logger');
const { resolvePhotoInput } = require('../../../telegram/messageDelivery');
const { getScreenPhotoInput } = require('../../../telegram/screenPhoto');
const { CB } = require('../../../telegram/callbacks/constants');
const { CB: SMM_CB } = require('../utils/smmCallbackData');
const { serviceDisplayLabel } = require('../services/displayLabelService');
const { formatMoney } = require('../utils/smmTextFormat');

function unwrapKeyboard(keyboard) {
    if (!keyboard) return {};
    const km = keyboard.reply_markup || keyboard;
    return km?.inline_keyboard ? { reply_markup: km } : keyboard;
}

/**
 * Notificação destacada com foto + legenda + botões (não edita painel).
 */
async function sendUserNotification(bot, telegramId, html, keyboard = null, screen = 'orders') {
    if (!bot?.telegram || !telegramId) return false;
    const photo = resolvePhotoInput(getScreenPhotoInput(screen, telegramId));
    const extra = { parse_mode: 'HTML', ...unwrapKeyboard(keyboard) };

    try {
        if (photo) {
            await bot.telegram.sendPhoto(telegramId, photo, { caption: html, ...extra });
        } else {
            await bot.telegram.sendMessage(telegramId, html, extra);
        }
        return true;
    } catch (e) {
        logger.warn('[SMM:notify] falha', { detail: e.message, screen });
        try {
            await bot.telegram.sendMessage(telegramId, html, extra);
            return true;
        } catch (e2) {
            logger.warn('[SMM:notify] fallback texto falhou', { detail: e2.message });
            return false;
        }
    }
}

function serviceTitle(svc) {
    if (!svc) return 'Serviço SMM';
    return serviceDisplayLabel(svc, { max: 80 });
}

function orderRef(orderId, smmOrderId) {
    if (orderId) return String(orderId).slice(-8);
    if (smmOrderId) return String(smmOrderId);
    return '—';
}

function orderCreatedKeyboard(smmOrderId, orderId) {
    const payCb = orderId ? `pp_${orderId}` : SMM_CB.HOME;
    return Markup.inlineKeyboard([
        [{ text: 'Pagar agora', callback_data: payCb }],
        [{ text: 'Cancelar', callback_data: orderId ? `cancel_${orderId}` : SMM_CB.cancelWizard }],
        [{ text: 'Menu', callback_data: CB.MENU_HOME }],
    ]);
}

function paymentApprovedKeyboard(smmOrderId) {
    return Markup.inlineKeyboard([
        [{ text: 'Ver status', callback_data: SMM_CB.orderView(smmOrderId) }],
        [{ text: 'Menu', callback_data: CB.MENU_HOME }],
    ]);
}

function orderSentKeyboard(smmOrderId) {
    return Markup.inlineKeyboard([
        [{ text: 'Status', callback_data: SMM_CB.orderView(smmOrderId) }],
        [{ text: 'Atualizar', callback_data: SMM_CB.orderView(smmOrderId) }],
        [{ text: 'Menu', callback_data: CB.MENU_HOME }],
    ]);
}

function orderCompletedKeyboard(smmOrderId) {
    return Markup.inlineKeyboard([
        [{ text: 'Meus pedidos', callback_data: SMM_CB.orders }],
        [{ text: 'Comprar novamente', callback_data: SMM_CB.HOME }],
        [{ text: 'Menu', callback_data: CB.MENU_HOME }],
    ]);
}

async function notifyOrderCreated(bot, { orderId, smmOrderId, svc, quantity, total, telegramId }) {
    const ref = orderRef(orderId, smmOrderId);
    const html =
        `<b>Pedido criado</b>\n\n` +
        `ID: <b>${ref}</b>\n` +
        `Serviço: <b>${serviceTitle(svc)}</b>\n` +
        `Quantidade: <b>${Number(quantity).toLocaleString('pt-BR')}</b>\n` +
        `Total: <b>${formatMoney(total)}</b>\n` +
        `Status: <b>Aguardando pagamento</b>\n\n` +
        `Toque em <b>Pagar agora</b> e escolha PIX ou cartão. A confirmação é automática após o pagamento.`;
    return sendUserNotification(
        bot,
        telegramId,
        html,
        orderCreatedKeyboard(smmOrderId, orderId),
        'orders'
    );
}

async function notifyPaymentApproved(bot, { orderId, smmOrderId, telegramId }) {
    const ref = orderRef(orderId, smmOrderId);
    const html =
        `<b>Pagamento aprovado</b>\n\n` +
        `Seu pedido foi enviado para processamento no fornecedor.\n\n` +
        `ID: <b>${ref}</b>`;
    return sendUserNotification(
        bot,
        telegramId,
        html,
        paymentApprovedKeyboard(smmOrderId),
        'orders'
    );
}

async function notifyOrderSent(bot, { orderId, smmOrderId, svc, quantity, total, telegramId }) {
    const ref = orderRef(orderId, smmOrderId);
    const html =
        `<b>Pedido enviado</b>\n\n` +
        `Seu pedido foi encaminhado para execução. O prazo depende do serviço contratado.\n\n` +
        `ID: <b>${ref}</b>\n` +
        `Serviço: <b>${serviceTitle(svc)}</b>\n` +
        `Quantidade: <b>${Number(quantity).toLocaleString('pt-BR')}</b>\n` +
        `Total: <b>${formatMoney(total)}</b>`;
    return sendUserNotification(
        bot,
        telegramId,
        html,
        orderSentKeyboard(smmOrderId),
        'orders'
    );
}

async function notifyOrderCompleted(bot, { orderId, smmOrderId, svc, quantity, telegramId }) {
    const ref = orderRef(orderId, smmOrderId);
    const html =
        `<b>Pedido concluído</b>\n\n` +
        `Seu serviço foi finalizado.\n\n` +
        `ID: <b>${ref}</b>\n` +
        `Serviço: <b>${serviceTitle(svc)}</b>\n` +
        `Quantidade: <b>${Number(quantity).toLocaleString('pt-BR')}</b>`;
    return sendUserNotification(
        bot,
        telegramId,
        html,
        orderCompletedKeyboard(smmOrderId),
        'orders'
    );
}

module.exports = {
    sendUserNotification,
    notifyOrderCreated,
    notifyPaymentApproved,
    notifyOrderSent,
    notifyOrderCompleted,
    orderCreatedKeyboard,
    paymentApprovedKeyboard,
    orderSentKeyboard,
    orderCompletedKeyboard,
};
