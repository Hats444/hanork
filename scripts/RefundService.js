'use strict';

const { Markup } = require('telegraf');
const { prisma } = require('../config/database');
const dbRaw = require('../config/database-sqlite').connect;
const logger = require('../config/logger');
const { withLockOrSkip } = require('../infrastructure/DistributedStateManager');

const KV_NOTIFY_PREFIX = 'refund_notify:';

function wasRefundNotified(orderId) {
    try {
        return !!dbRaw().prepare('SELECT key FROM kv_store WHERE key = ?').get(`${KV_NOTIFY_PREFIX}${orderId}`);
    } catch {
        return false;
    }
}

function markRefundNotified(orderId) {
    dbRaw().prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').run(
        `${KV_NOTIFY_PREFIX}${orderId}`,
        String(Date.now())
    );
}

function isRefundedStatus(status) {
    return status === 'FAILED' || status === 'REFUNDED';
}

function buildConfirmKeyboard(orderId) {
    return Markup.inlineKeyboard([
        [{ text: '✅ Confirmar Reembolso', callback_data: `refund_${orderId}` }],
        [{ text: '❌ Cancelar', callback_data: 'a_menu' }],
    ]);
}

async function processRefund(ctx, orderId, { notifyTelegram } = {}) {
    const result = await withLockOrSkip(`refund:${orderId}`, 30000, async () => {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) {
            return { ok: false, reason: 'not_found' };
        }

        if (isRefundedStatus(order.status)) {
            return { ok: false, reason: 'already', order };
        }

        await prisma.order.update({
            where: { id: orderId },
            data: {
                status: 'FAILED',
                error_message: order.error_message || 'Reembolsado pelo admin',
            },
        });

        const user = await prisma.user.findUnique({ where: { id: order.user_id } });
        let notified = false;
        if (user?.telegram_id && notifyTelegram && !wasRefundNotified(orderId)) {
            try {
                await notifyTelegram.sendMessage(
                    parseInt(user.telegram_id, 10),
                    `♻️ <b>Seu pedido foi reembolsado</b>\n\n` +
                    `🔑 Pedido: #${orderId.slice(-8)}\n` +
                    `💰 R$ ${order.total.toFixed(2)}\n\n` +
                    `O reembolso será processado em até 5 dias úteis via ${order.payment_method || 'método original'}.`,
                    { parse_mode: 'HTML' }
                );
                markRefundNotified(orderId);
                notified = true;
            } catch (e) {
                logger.warn('[Refund] notify failed', { orderId, message: e?.message });
            }
        }

        return { ok: true, order, notified };
    });

    if (result === null) {
        await ctx.answerCbQuery('⏳ Reembolso já está sendo processado…', { show_alert: true });
        return { ok: false, reason: 'lock' };
    }

    if (result.reason === 'not_found') {
        await ctx.answerCbQuery('Pedido não encontrado.', { show_alert: true });
        return result;
    }

    if (result.reason === 'already') {
        await ctx.answerCbQuery('✅ Este pedido já foi reembolsado/cancelado.', { show_alert: true });
        try {
            const Msg = require('../telegram/Msg');
            await Msg.edit(
                ctx,
                `✅ <b>Reembolso já registrado</b>\n\nPedido #${orderId.slice(-8)} já estava cancelado.`,
                Markup.inlineKeyboard([[{ text: '🔙 Admin', callback_data: 'a_menu' }]])
            );
        } catch (_) { /* ignore */ }
        return result;
    }

    await ctx.answerCbQuery('✅ Reembolso registrado!');
    const note = result.notified ? '_Notificação enviada ao cliente._' : '_Cliente já havia sido notificado._';
    try {
        const Msg = require('../telegram/Msg');
        await Msg.edit(
            ctx,
            `✅ <b>Reembolso registrado</b>\n\nPedido #${orderId.slice(-8)} marcado como cancelado.\n${note}`,
            Markup.inlineKeyboard([[{ text: '🔙 Admin', callback_data: 'a_menu' }]])
        );
    } catch (_) { /* ignore */ }

    logger.info('[Refund] processed', { orderId, admin: ctx.from?.id });
    return result;
}

module.exports = {
    isRefundedStatus,
    buildConfirmKeyboard,
    processRefund,
};
