'use strict';

/**
 * Poll automático do Mercado Pago após exibir QR PIX (V4 QW-2).
 * Desative com PIX_AUTO_POLL=0
 */

const logger = require('../../config/logger');
const PaymentCheckService = require('../../services/PaymentCheckService');

/** @type {Map<string, NodeJS.Timeout[]>} */
const activePolls = new Map();

function isEnabled() {
    return String(process.env.PIX_AUTO_POLL || '1') !== '0';
}

function cancelPixAutoPoll(orderId) {
    const key = String(orderId || '');
    const timers = activePolls.get(key);
    if (timers?.length) {
        for (const t of timers) clearTimeout(t);
    }
    activePolls.delete(key);
}

/**
 * @param {string} orderId
 * @param {object} ctx — Telegraf context (from.id estável)
 * @param {object} deps — prisma, bot, MP, comprasPendentes, cartKey, log
 */
function schedulePixAutoPoll(orderId, ctx, deps) {
    if (!isEnabled() || !orderId || !ctx?.from?.id) return;
    cancelPixAutoPoll(orderId);

    const maxAttempts = Math.max(1, parseInt(process.env.PIX_AUTO_POLL_ATTEMPTS || '10', 10));
    const intervalMs = Math.max(5000, parseInt(process.env.PIX_AUTO_POLL_INTERVAL_MS || '30000', 10));
    const timers = [];

    const runOnce = async (attempt) => {
        if (!activePolls.has(String(orderId))) return;

        try {
            const order = await deps.prisma.order.findUnique({ where: { id: orderId } });
            if (!order || order.status !== 'WAITING_PAYMENT') {
                cancelPixAutoPoll(orderId);
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
                cancelPixAutoPoll(orderId);
                logger.info('[PAYMENT] PIX auto-poll confirmou', { orderId, attempt, reason: result.reason });
            }
        } catch (e) {
            logger.debug('[PAYMENT] PIX auto-poll:', e.message);
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
    logger.debug('[PAYMENT] PIX auto-poll agendado', { orderId, maxAttempts, intervalMs });
}

module.exports = {
    schedulePixAutoPoll,
    cancelPixAutoPoll,
    isEnabled,
};
