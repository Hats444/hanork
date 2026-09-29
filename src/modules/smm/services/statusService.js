'use strict';

const ProviderManager = require('../providers/ProviderManager');
const SmmOrderRepository = require('../repositories/smmOrderRepository');
const { ORDER_STATUS, mapProviderStatus } = require('../constants/orderStatuses');
const { formatMoney } = require('../utils/smmTextFormat');
const logger = require('../../../config/logger');
const { orderStatusNoticeKeyboard } = require('../keyboards/smmNoticeKeyboards');
const { handleTerminalStatus, buildUserTerminalMessage } = require('./smmAlertService');
const { notifyOrderCompleted, sendUserNotification } = require('../helpers/smmUserNotify');
const { applyFailureCredit } = require('./smmFailureRecoveryService');
const SmmServiceRepository = require('../repositories/smmServiceRepository');

const TERMINAL_STATUSES = new Set([
    ORDER_STATUS.COMPLETED,
    ORDER_STATUS.CANCELED,
    ORDER_STATUS.FAILED,
]);

function orderRef(order) {
    if (order.hanork_order_id) return `#${String(order.hanork_order_id).slice(-8)}`;
    return `#${order.id}`;
}

function buildTerminalMessage(order, status) {
    const ref = orderRef(order);
    const qty = Number(order.quantity || 0).toLocaleString('pt-BR');
    const total = formatMoney(order.sale_price);

    if (status === ORDER_STATUS.COMPLETED) {
        return (
            `🎉 <b>Pedido concluído</b>\n\n` +
            `${ref}\n` +
            `Quantidade: <b>${qty}</b>\n` +
            `Total: <b>${total}</b>\n\n` +
            `<i>Obrigado por usar o Hanork SMM.</i>`
        );
    }
    if (status === ORDER_STATUS.CANCELED) {
        return buildUserTerminalMessage(order, 'canceled');
    }
    if (status === ORDER_STATUS.FAILED) {
        return buildUserTerminalMessage(order, 'failed');
    }
    return null;
}

async function notifyTerminalStatus(bot, order, status) {
    if (!TERMINAL_STATUSES.has(status)) return false;

    const isFailure = status === ORDER_STATUS.FAILED || status === ORDER_STATUS.CANCELED;

    if (isFailure && order.hanork_order_id) {
        const reason =
            status === ORDER_STATUS.FAILED ? 'order_failed' : 'order_canceled';
        const terminalStatus = status === ORDER_STATUS.FAILED ? 'failed' : 'canceled';
        await handleTerminalStatus(order, terminalStatus);
        const { notified } = await applyFailureCredit({
            hanorkOrderId: order.hanork_order_id,
            smmOrder: order,
            reason,
            detail: `provider_status=${status}`,
            bot,
            markFailed: status === ORDER_STATUS.FAILED,
            terminalStatus,
        });
        return notified;
    }

    if (!bot?.telegram || !order.telegram_id) return false;

    if (status === ORDER_STATUS.COMPLETED) {
        const svc = SmmServiceRepository.findById(order.service_id);
        return notifyOrderCompleted(bot, {
            orderId: order.hanork_order_id,
            smmOrderId: order.id,
            svc,
            quantity: order.quantity,
            telegramId: order.telegram_id,
        });
    }

    const text = buildTerminalMessage(order, status);
    if (!text) return false;
    try {
        return sendUserNotification(
            bot,
            order.telegram_id,
            text,
            orderStatusNoticeKeyboard(order.id),
            'orders'
        );
    } catch (e) {
        logger.warn('[SMM:status] notify falhou', {
            orderId: order.id,
            telegramId: order.telegram_id,
            detail: e.message,
        });
        return false;
    }
}

const SmmStatusService = {
    async pollOrder(smmOrder, bot) {
        if (!smmOrder?.provider_order_id) return { updated: false };
        const provider = ProviderManager.getProviderForOrder(smmOrder);
        if (!provider) return { updated: false, error: 'no_provider' };

        const raw = await provider.getOrderStatus(smmOrder.provider_order_id);
        if (raw?.error) return { updated: false, error: raw.message };

        const status = mapProviderStatus(raw);
        if (status && status !== smmOrder.status) {
            SmmOrderRepository.updateStatus(smmOrder.id, status);
            const notified = await notifyTerminalStatus(bot, { ...smmOrder, status }, status);
            return { updated: true, status, raw, notified };
        }
        return { updated: false, status: smmOrder.status, raw };
    },

    listOpen(limit = 100) {
        return SmmOrderRepository.listByStatus(
            [ORDER_STATUS.SUBMITTED, ORDER_STATUS.PROCESSING, ORDER_STATUS.PARTIAL],
            limit
        );
    },

    notifyTerminalStatus,
    buildTerminalMessage,
    TERMINAL_STATUSES,
};

module.exports = SmmStatusService;
