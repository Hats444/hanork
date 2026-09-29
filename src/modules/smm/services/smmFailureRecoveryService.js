'use strict';

const logger = require('../../../config/logger');
const SmmOrderRepository = require('../repositories/smmOrderRepository');
const OrderFailureCreditService = require('../../../services/OrderFailureCreditService');
const { ORDER_STATUS } = require('../constants/orderStatuses');
const { handleFulfillFailure, buildUserTerminalMessage } = require('./smmAlertService');
const { sendUserNotification } = require('../helpers/smmUserNotify');

const TERMINAL_SMM = new Set([
    ORDER_STATUS.COMPLETED,
    ORDER_STATUS.CANCELED,
    ORDER_STATUS.FAILED,
]);

function recordEvent(smmOrderId, eventType, detail) {
    try {
        const { prisma } = require('../../../config/database-sqlite');
        prisma.smmOrderEvent.record(smmOrderId, eventType, detail);
    } catch {
        /* optional */
    }
}

/**
 * Crédito na carteira + notificação única para falhas SMM pós-pagamento.
 */
async function applyFailureCredit({
    hanorkOrderId,
    smmOrder,
    reason,
    detail = null,
    service = null,
    bot = null,
    markFailed = true,
    terminalStatus = null,
}) {
    if (!hanorkOrderId || !smmOrder) {
        return { ok: false, reason: 'missing_order' };
    }

    if (markFailed && smmOrder.status && !TERMINAL_SMM.has(smmOrder.status)) {
        const nextStatus =
            terminalStatus === 'canceled' ? ORDER_STATUS.CANCELED : ORDER_STATUS.FAILED;
        SmmOrderRepository.updateStatus(smmOrder.id, nextStatus);
        smmOrder = { ...smmOrder, status: nextStatus };
        recordEvent(smmOrder.id, 'SMM_FAILURE', `${reason}${detail ? ` · ${detail}` : ''}`.slice(0, 480));
    }

    const creditResult = await OrderFailureCreditService.creditOnFailure(hanorkOrderId, reason, {
        module: 'smm',
        telegramId: smmOrder.telegram_id,
        notifyUser: false,
    });

    let text;
    let keyboard;

    if (terminalStatus === 'failed' || terminalStatus === 'canceled') {
        text = buildUserTerminalMessage(smmOrder, terminalStatus);
        keyboard = OrderFailureCreditService.walletNotifyKeyboard();
    } else {
        const notice = await handleFulfillFailure({
            reason,
            hanorkOrderId,
            smmOrder,
            service,
            detail,
        });
        text = notice.text;
        keyboard = notice.keyboard;
    }

    if (creditResult?.ok && !creditResult.skipped) {
        text += OrderFailureCreditService.userCreditLine(
            creditResult,
            Number(smmOrder.sale_price || 0)
        );
        keyboard = OrderFailureCreditService.walletNotifyKeyboard();
    } else if (creditResult?.skipped && creditResult.reason === 'already_handled') {
        text +=
            `\n\n<i>Seu saldo já foi creditado anteriormente neste pedido — use «Carteira» no checkout.</i>`;
        keyboard = OrderFailureCreditService.walletNotifyKeyboard();
    }

    const resolvedBot = bot || global.botInstance;
    let notified = false;
    if (resolvedBot && smmOrder.telegram_id) {
        notified = await sendUserNotification(
            resolvedBot,
            smmOrder.telegram_id,
            text,
            keyboard,
            'orders'
        );
    }

    logger.info('[SMM:recovery] falha tratada', {
        hanorkOrderId,
        smmOrderId: smmOrder.id,
        reason,
        credited: !!(creditResult?.ok && !creditResult.skipped),
        notified,
    });

    return { ok: true, creditResult, notified, text };
}

module.exports = {
    applyFailureCredit,
    TERMINAL_SMM,
};
