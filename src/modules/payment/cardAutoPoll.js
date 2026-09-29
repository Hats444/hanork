'use strict';

/**
 * Poll automático do Mercado Pago após checkout cartão/boleto (Checkout Pro).
 * PIX já tem pixAutoPoll; cartão dependia só de webhook ou «Verificar» manual.
 * Desative com CARD_AUTO_POLL=0
 */

const logger = require('../../config/logger');
const PaymentCheckService = require('../../services/PaymentCheckService');

/** @type {Map<string, NodeJS.Timeout[]>} */
const activePolls = new Map();

function isEnabled() {
    return String(process.env.CARD_AUTO_POLL ?? '1') !== '0';
}

function cancelCardAutoPoll(orderId) {
    const key = String(orderId || '');
    const timers = activePolls.get(key);
    if (timers?.length) {
        for (const t of timers) clearTimeout(t);
    }
    activePolls.delete(key);
}

async function notifyPaymentConfirmed(ctx, deps, orderId) {
    const chatId = ctx?.from?.id;
    if (!chatId || !deps?.bot?.telegram) return;
    let isSmm = false;
    try {
        const { isSmmHanorkOrder } = require('../smm/helpers/smmPendingHelper');
        isSmm = isSmmHanorkOrder(orderId);
    } catch {
        /* ignore */
    }
    const text = isSmm
        ? '<b>Pagamento confirmado</b>\n\nSeu pedido de serviços está sendo processado. Você receberá atualizações neste chat.'
        : '<b>Pagamento confirmado</b>\n\nPreparando a entrega do seu pedido neste chat.';
    try {
        await deps.bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (e) {
        logger.debug('[PAYMENT] card auto-poll notify:', e.message);
    }
}

/**
 * @param {string} orderId
 * @param {object} ctx — Telegraf context (from.id estável)
 * @param {object} deps — prisma, bot, MP, comprasPendentes, cartKey, log
 */
function scheduleCardAutoPoll(orderId, ctx, deps) {
    if (!isEnabled() || !orderId || !ctx?.from?.id) return;
    cancelCardAutoPoll(orderId);

    const maxAttempts = Math.max(1, parseInt(process.env.CARD_AUTO_POLL_ATTEMPTS || '24', 10));
    const intervalMs = Math.max(10000, parseInt(process.env.CARD_AUTO_POLL_INTERVAL_MS || '20000', 10));
    const timers = [];

    const runOnce = async (attempt) => {
        if (!activePolls.has(String(orderId))) return;

        try {
            const order = await deps.prisma.order.findUnique({ where: { id: orderId } });
            if (!order || order.status !== 'WAITING_PAYMENT') {
                cancelCardAutoPoll(orderId);
                return;
            }

            const result = await PaymentCheckService.runManualPaymentCheck(
                ctx,
                orderId,
                deps,
                {
                    dismissCb: async () => {},
                    notifyUser: async () => {},
                }
            );

            if (result?.ok) {
                cancelCardAutoPoll(orderId);
                await notifyPaymentConfirmed(ctx, deps, orderId);
                logger.info('[PAYMENT] cartão auto-poll confirmou', {
                    orderId,
                    attempt,
                    reason: result.reason,
                });
            }
        } catch (e) {
            logger.debug('[PAYMENT] cartão auto-poll:', e.message);
        }
    };

    for (let i = 1; i <= maxAttempts; i++) {
        timers.push(
            setTimeout(() => {
                runOnce(i).catch(() => {});
            }, intervalMs * i)
        );
    }

    activePolls.set(String(orderId), timers);
    logger.debug('[PAYMENT] cartão auto-poll agendado', { orderId, maxAttempts, intervalMs });
}

module.exports = {
    scheduleCardAutoPoll,
    cancelCardAutoPoll,
    isEnabled,
};
