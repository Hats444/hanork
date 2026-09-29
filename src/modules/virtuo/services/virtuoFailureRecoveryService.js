'use strict';

const logger = require('../../../config/logger');
const { prisma } = require('../../../config/database-sqlite');
const OrderFailureCreditService = require('../../../services/OrderFailureCreditService');
const { formatMoney } = require('../utils/virtuoTextFormat');
const VirtuoOrderRepository = require('../repositories/virtuoOrderRepository');

const KV_REFUND_PREFIX = 'virtuo_refund:';
const KV_REFUND_NOTIFY_PREFIX = 'virtuo_refund_notify:';

function wasRefundHandled(orderId) {
    return OrderFailureCreditService.wasCreditHandled(orderId);
}

function markRefundHandled(orderId) {
    try {
        const dbRaw = require('../../../config/database-sqlite').connect;
        dbRaw()
            .prepare('INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))')
            .run(`${KV_REFUND_PREFIX}${orderId}`, String(Date.now()));
    } catch {
        /* ignore */
    }
}

async function notifyRefundToUser(hanorkOrderId, creditResult, reason) {
    return OrderFailureCreditService.notifyUserCredit(hanorkOrderId, creditResult, {
        reason,
        module: 'virtuo',
    });
}

async function processAutomaticRefund(hanorkOrderId, reason = 'fulfill_failed') {
    const result = await OrderFailureCreditService.creditOnFailure(hanorkOrderId, reason, {
        module: 'virtuo',
    });
    if (result?.ok && !result.skipped) {
        markRefundHandled(hanorkOrderId);
    }
    return result;
}

function refundUserLine(creditResult, total) {
    return OrderFailureCreditService.userCreditLine(creditResult, total);
}

async function handleTerminalFailure({ hanorkOrderId, virtuoOrder, reason, detail, bot, guard }) {
    const VirtuoAlertService = require('./virtuoAlertService');
    const creditResult = await processAutomaticRefund(hanorkOrderId, reason);
    const payload = await VirtuoAlertService.handleFulfillFailure({
        reason,
        hanorkOrderId,
        virtuoOrder,
        detail,
        bot,
        guard,
        refundResult: creditResult,
    });
    return { refundResult: creditResult, payload };
}

module.exports = {
    processAutomaticRefund,
    refundUserLine,
    handleTerminalFailure,
    notifyRefundToUser,
    wasRefundHandled,
};
