'use strict';

const logger = require('../config/logger');
const SafeWebhookHandler = require('../modules/payment/SafeWebhookHandler');
const { isCancelled } = require('../modules/order/orderStatus');
const {
    mpAmountMatchesOrder,
    orderBelongsToUser,
    resolveMpPaymentForOrder,
} = require('../modules/payment/paymentCheckUtils');

const STATUS_MAP = {
    CREATED: 'Pedido criado',
    WAITING_PAYMENT: 'Aguardando pagamento',
    PAID: 'Pago — processando entrega…',
    DELIVERING: 'Preparando entrega…',
    DELIVERED: 'Entregue',
    FAILED: 'Cancelado',
    CANCELLED: 'Cancelado',
    PAYMENT_ERROR: 'Erro ao confirmar — tentando de novo…',
};

/**
 * Fluxo do callback legado check_{orderId} — extraído de bot.js para testes.
 * @param {object} ctx — Telegraf context
 * @param {string} orderId
 * @param {object} deps — prisma, bot, MP, comprasPendentes, cartKey, log
 * @param {object} ui — { dismissCb, notifyUser }
 */
async function runManualPaymentCheck(ctx, orderId, deps, ui) {
    const { prisma, bot, MP, comprasPendentes, cartKey, log = logger } = deps;
    const safeWebhook = deps.safeWebhookHandler || SafeWebhookHandler;
    const { dismissCb, notifyUser } = ui;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
        await notifyUser('Pedido não encontrado', { alert: true });
        return { ok: false, reason: 'not_found' };
    }
    if (!(await orderBelongsToUser(prisma, order, ctx.from.id))) {
        await notifyUser('Este pedido não é seu', { alert: true });
        return { ok: false, reason: 'forbidden' };
    }

    await dismissCb('Verificando…');

    if (order.status === 'DELIVERED') {
        await notifyUser('Pedido já entregue', { alert: true });
        return { ok: false, reason: 'already_delivered' };
    }
    if (order.status === 'PAID' || order.status === 'DELIVERING') {
        await safeWebhook.ensureDeliveryForOrder(order);
        return { ok: true, reason: 'ensure_delivery_paid' };
    }
    if (order.status === 'PAYMENT_ERROR') {
        log.info('[PAYMENT] check_ retry após PAYMENT_ERROR', { orderId });
    }
    if (isCancelled(order.status)) {
        await notifyUser('Pedido cancelado', { alert: true });
        return { ok: false, reason: 'cancelled' };
    }

    const pending = await comprasPendentes.get(cartKey(ctx));
    let resolvedPending = pending;
    if (!resolvedPending?.mpPreferenceId) {
        try {
            const { getStateManager } = require('../modules/state');
            const byOrder = await getStateManager().findPendingPurchaseByOrderId(orderId);
            if (byOrder) resolvedPending = { ...resolvedPending, ...byOrder };
        } catch {
            /* ignore */
        }
    }
    const mpPayment = await resolveMpPaymentForOrder(order, resolvedPending, MP);

    if (mpPayment?.status === 'approved') {
        if (!mpAmountMatchesOrder(mpPayment, order)) {
            log.error('[PAYMENT] check_ valor divergente', {
                orderId,
                total: order.total,
                mp: mpPayment.transaction_amount,
            });
            await notifyUser('Valor pago não confere com o pedido. Contate o suporte.', { alert: true });
            return { ok: false, reason: 'amount_mismatch' };
        }

        let result;
        try {
            result = await safeWebhook.processPayment(
                String(mpPayment.id),
                {
                    external_reference: order.external_reference || order.id,
                    status: 'approved',
                    transaction_amount: mpPayment.transaction_amount,
                    payment_method_id: mpPayment.payment_method_id,
                },
                bot
            );
        } catch (e) {
            log.error('[PAYMENT] check_ processPayment error:', e.message);
            await notifyUser('Erro ao confirmar pagamento. Tente novamente em instantes.', { alert: true });
            return { ok: false, reason: 'process_error' };
        }

        if (result.processed) {
            await comprasPendentes.delete(cartKey(ctx));
            log.info('[PAYMENT] check_ confirmado', { orderId, paymentId: mpPayment.id });
            let isSmm = false;
            let isWaDiv = false;
            try {
                const { isSmmHanorkOrder } = require('../modules/smm/helpers/smmPendingHelper');
                isSmm = isSmmHanorkOrder(orderId);
            } catch {
                /* ignore */
            }
            try {
                const { isWaDivulgacaoHanorkOrder } = require('../modules/wa-divulgacao/helpers/waDivulgacaoPendingHelper');
                isWaDiv = isWaDivulgacaoHanorkOrder(orderId);
            } catch {
                /* ignore */
            }
            if (isWaDiv) {
                try {
                    const { showWaDivPaymentSuccessPanel } = require('../modules/wa-divulgacao/handlers/waDivulgacaoUiHandlers');
                    await showWaDivPaymentSuccessPanel(ctx);
                } catch {
                    /* ignore */
                }
                await notifyUser('Pagamento confirmado. Seu Hanork Div está sendo liberado.', { alert: false });
            } else {
                await notifyUser(
                    isSmm
                        ? 'Pagamento confirmado. Seu pedido de serviços está sendo processado.'
                        : 'Pagamento confirmado. Preparando a entrega do seu pedido.',
                    { alert: false }
                );
            }
            return { ok: true, reason: 'processed', paymentId: mpPayment.id };
        }
        if (result.reason === 'already_delivered') {
            await notifyUser('Pedido já entregue', { alert: true });
            return { ok: false, reason: 'already_delivered' };
        }
        if (result.reason === 'already_paid') {
            const refreshed = await prisma.order.findUnique({ where: { id: orderId } });
            await safeWebhook.ensureDeliveryForOrder(refreshed || order);
            if (refreshed?.status === 'DELIVERED') {
                await notifyUser('Pedido já entregue', { alert: true });
            }
            return { ok: true, reason: 'already_paid' };
        }
        if (result.reason === 'lock_unavailable') {
            await notifyUser(
                'Pagamento em processamento. Aguarde alguns segundos e tente de novo.',
                { alert: true }
            );
            return { ok: false, reason: 'lock_unavailable' };
        }
        if (result.reason === 'amount_mismatch') {
            await notifyUser('Valor pago não confere com o pedido. Contate o suporte.', { alert: true });
            return { ok: false, reason: 'amount_mismatch' };
        }
        if (result.reason === 'order_cancelled') {
            await notifyUser('Pedido cancelado', { alert: true });
            return { ok: false, reason: 'order_cancelled' };
        }
    }

    if (mpPayment?.status === 'pending' || mpPayment?.status === 'in_process') {
        await notifyUser('Pagamento ainda em processamento no Mercado Pago', { alert: true });
        return { ok: false, reason: 'mp_pending' };
    }
    if (mpPayment?.status === 'rejected' || mpPayment?.status === 'cancelled') {
        await notifyUser('Pagamento rejeitado ou cancelado no Mercado Pago', { alert: true });
        return { ok: false, reason: 'mp_rejected' };
    }

    await notifyUser(
        STATUS_MAP[order.status] || 'Pagamento ainda não identificado. Aguarde ou toque em Verificar pagamento.',
        { alert: true }
    );
    return { ok: false, reason: 'waiting', status: order.status };
}

module.exports = {
    runManualPaymentCheck,
    STATUS_MAP,
};
