'use strict';

const { prisma } = require('../../../config/database-sqlite');
const VirtuoOrderRepository = require('../repositories/virtuoOrderRepository');
const VirtuoFulfillmentService = require('./fulfillmentService');
const VirtuoConfig = require('../virtuoConfig');
const { ORDER_STATUS } = require('../constants/orderStatuses');
const { CB } = require('../utils/virtuoCallbackData');
const L = require('../utils/virtuoLabels');
const { isActivationExpired } = require('../utils/virtuoActivationTiming');

const BLOCKING_STATUSES = new Set(['paid', 'waiting_sms']);

function isBlockingStatus(status) {
    return BLOCKING_STATUSES.has(String(status || '').toLowerCase());
}

function pendingBlockMessage() {
    return (
        '<b>Você ainda tem um número aguardando SMS</b>\n\n' +
        '<i>Se já cancelou no site do provedor, toque em <b>Atualizar status</b>.</i>\n' +
        '<i>Para cancelar pelo bot e comprar outro, use <b>Cancelar pedido</b>.</i>'
    );
}

function pendingBlockKeyboard(pendingOrder, { backCallback, backLabel } = {}) {
    const rows = [];
    if (pendingOrder?.id) {
        rows.push([
            { text: '🔄 Atualizar status', callback_data: CB.orderRefresh(pendingOrder.id) },
            { text: '❌ Cancelar pedido', callback_data: CB.orderCancel(pendingOrder.id) },
        ]);
    } else {
        rows.push([
            { text: '🔄 Atualizar status', callback_data: CB.pendingSync() },
            { text: '❌ Liberar e comprar outro', callback_data: CB.pendingRelease() },
        ]);
    }
    if (backCallback) {
        rows.push([{ text: backLabel || '↩ Voltar', callback_data: backCallback }]);
    }
    rows.push([{ text: L.HOME, callback_data: CB.HOME }]);
    return { inline_keyboard: rows };
}

async function reconcileOrder(order, bot = null) {
    if (!order?.id) return { stillPending: false, order: null };

    const status = String(order.status || '').toLowerCase();

    if (!isBlockingStatus(status) && status !== ORDER_STATUS.AWAITING_PAYMENT) {
        return { stillPending: false, order };
    }

    if (status === ORDER_STATUS.AWAITING_PAYMENT) {
        try {
            const ho = await prisma.order.findUnique({ where: { id: order.hanork_order_id } });
            if (!ho || ho.status !== 'WAITING_PAYMENT') {
                VirtuoOrderRepository.updateStatus(order.id, ORDER_STATUS.FAILED, {
                    provider_status: 'checkout_abandoned',
                });
                return {
                    stillPending: false,
                    reconciled: true,
                    order: VirtuoOrderRepository.findById(order.id),
                };
            }
        } catch {
            /* ignore */
        }
        return { stillPending: false, order };
    }

    if (order.virtuo_order_id) {
        const poll = await VirtuoFulfillmentService.pollActivation(order, bot);
        const fresh = VirtuoOrderRepository.findById(order.id);
        return {
            stillPending: isBlockingStatus(fresh?.status),
            order: fresh,
            reconciled: Boolean(poll?.updated),
            poll,
        };
    }

    if (status === ORDER_STATUS.PAID) {
        const since = Date.parse(order.updated_at || order.created_at || '');
        const age = Number.isFinite(since) ? Date.now() - since : 0;

        if (bot && age > 2 * 60 * 1000) {
            await VirtuoFulfillmentService.fulfillHanorkOrder(order.hanork_order_id, bot).catch(() => { });
        }

        let fresh = VirtuoOrderRepository.findById(order.id);
        if (isBlockingStatus(fresh?.status)) {
            if (fresh?.virtuo_order_id && fresh?.phone && isActivationExpired(fresh)) {
                await VirtuoFulfillmentService.handleTimeout(fresh, bot);
                fresh = VirtuoOrderRepository.findById(order.id);
                return { stillPending: false, order: fresh, reconciled: true };
            }
            if (!fresh?.virtuo_order_id && age > VirtuoConfig.activationCancelAtMs) {
                await VirtuoFulfillmentService.markExternallyCancelled(fresh, bot, 'FULFILL_STUCK');
                fresh = VirtuoOrderRepository.findById(order.id);
                return { stillPending: false, order: fresh, reconciled: true };
            }
        }

        return { stillPending: isBlockingStatus(fresh?.status), order: fresh, reconciled: age > 2 * 60 * 1000 };
    }

    return { stillPending: isBlockingStatus(status), order };
}

async function reconcileTelegramPending(telegramId, bot = null) {
    const order = VirtuoOrderRepository.findPendingByTelegram(telegramId);
    if (!order) return { stillPending: false, order: null };
    const result = await reconcileOrder(order, bot);
    return { ...result, order: result.order || order };
}

async function reconcileAndGetBlockingPending(telegramId, bot = null) {
    const result = await reconcileTelegramPending(telegramId, bot);
    if (result.stillPending && result.order) return result.order;
    return null;
}

module.exports = {
    isBlockingStatus,
    pendingBlockMessage,
    pendingBlockKeyboard,
    reconcileOrder,
    reconcileTelegramPending,
    reconcileAndGetBlockingPending,
};
