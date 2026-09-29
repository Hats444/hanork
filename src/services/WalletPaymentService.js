'use strict';

const logger = require('../config/logger');
const { withLock } = require('../infrastructure/DistributedStateManager');
const UserWalletService = require('./UserWalletService');
const QueueHelpers = require('../modules/queue/QueueHelpers');
const { eventBus, DomainEvents } = require('../infrastructure');
const { CB } = require('../telegram/callbacks/constants');

async function fulfillPaidOrder(ctx, order, pending, user, total, saldoBefore, deps) {
    const { isSmmHanorkOrder } = require('../modules/smm/helpers/smmPendingHelper');
    const { isVirtuoHanorkOrder } = require('../modules/virtuo/helpers/virtuoPendingHelper');

    if (isSmmHanorkOrder(order.id) || pending.orderKind === 'smm') {
        await QueueHelpers.scheduleSmmFulfill(order.id, user.telegram_id, user.id);
        await eventBus.emit(DomainEvents.ORDER_PAID, {
            orderId: order.id,
            userId: user.id,
            total,
            items: [],
            orderKind: 'smm',
            paymentId: `wallet-${order.id}`,
            tenantId: order.tenant_id || 'default',
        });
        await deps.Msg.edit(
            ctx,
            `✅ <b>Pago com carteira Hanork</b>\n\n` +
                `💳 R$ ${total.toFixed(2)} debitados.\n` +
                `💵 Saldo restante: <b>R$ ${(saldoBefore - total).toFixed(2)}</b>\n\n` +
                `<i>Pedido SMM em processamento.</i>`,
            {
                parse_mode: 'HTML',
                ...deps.Markup.inlineKeyboard([
                    [{ text: '📱 Meus pedidos SMM', callback_data: 'smm:ord' }],
                    [{ text: '💳 Carteira', callback_data: 'user:wallet' }],
                    [{ text: '🏠 Menu', callback_data: CB.MENU_HOME }],
                ]),
            }
        );
        return;
    }

    if (isVirtuoHanorkOrder(order.id) || pending.orderKind === 'virtuo') {
        await QueueHelpers.scheduleVirtuoFulfill(order.id, user.telegram_id, user.id);
        await eventBus.emit(DomainEvents.ORDER_PAID, {
            orderId: order.id,
            userId: user.id,
            total,
            items: [],
            orderKind: 'virtuo',
            paymentId: `wallet-${order.id}`,
            tenantId: order.tenant_id || 'default',
        });
        await deps.Msg.edit(
            ctx,
            `✅ <b>Pago com carteira Hanork</b>\n\n` +
                `💳 R$ ${total.toFixed(2)} debitados.\n` +
                `💵 Saldo restante: <b>R$ ${(saldoBefore - total).toFixed(2)}</b>\n\n` +
                `<i>Reservando seu número SMS…</i>`,
            {
                parse_mode: 'HTML',
                ...deps.Markup.inlineKeyboard([
                    [{ text: '📞 Números SMS', callback_data: 'virtuo:home' }],
                    [{ text: '💳 Carteira', callback_data: 'user:wallet' }],
                    [{ text: '🏠 Menu', callback_data: CB.MENU_HOME }],
                ]),
            }
        );
        return;
    }

    await QueueHelpers.scheduleDelivery(order.id, user.telegram_id, pending.items, user.id);
    await eventBus.emit(DomainEvents.ORDER_PAID, {
        orderId: order.id,
        userId: user.id,
        total,
        items: pending.items,
        paymentId: `wallet-${order.id}`,
        tenantId: order.tenant_id || 'default',
    });
    await deps.Msg.edit(
        ctx,
        `✅ <b>Pago com carteira Hanork</b>\n\n` +
            `💳 R$ ${total.toFixed(2)} debitados.\n` +
            `💵 Saldo restante: <b>R$ ${(saldoBefore - total).toFixed(2)}</b>\n\n` +
            `<i>Entrega automática após confirmação.</i>`,
        {
            parse_mode: 'HTML',
            ...deps.Markup.inlineKeyboard([
                [{ text: '📋 Meus pedidos', callback_data: 'order:list' }],
                [{ text: '💳 Carteira', callback_data: 'user:wallet' }],
                [{ text: '🏠 Menu', callback_data: CB.MENU_HOME }],
            ]),
        }
    );
}

class WalletPaymentService {
    async processWalletPayment(ctx, orderId, deps) {
        const uid = ctx.from?.id;
        if (!uid) throw new Error('user id missing');

        return withLock(`payment:wallet:${orderId}`, 15000, async () => {
            const key = deps.cartKey(ctx);
            const pending = await deps.comprasPendentes.get(key);
            if (!pending || pending.orderId !== orderId) {
                await deps.Msg.edit(
                    ctx,
                    '❌ Pedido não encontrado ou expirado.',
                    deps.Markup.inlineKeyboard([[{ text: '🏠 Menu', callback_data: CB.MENU_HOME }]])
                );
                return;
            }

            const user = await deps.prisma.user.findUnique({
                where: { telegram_id: String(uid) },
            });
            if (!user) {
                await deps.Msg.edit(ctx, '❌ Faça /start primeiro.');
                return;
            }

            const order = await deps.prisma.order.findUnique({ where: { id: orderId } });
            if (!order || order.user_id !== user.id) {
                await deps.Msg.edit(
                    ctx,
                    '❌ Pedido inválido.',
                    deps.Markup.inlineKeyboard([[{ text: '🏠 Menu', callback_data: CB.MENU_HOME }]])
                );
                return;
            }
            if (order.status !== 'WAITING_PAYMENT') {
                await deps.Msg.edit(
                    ctx,
                    '❌ Este pedido já foi processado.',
                    deps.Markup.inlineKeyboard([[{ text: '🏠 Menu', callback_data: CB.MENU_HOME }]])
                );
                return;
            }

            const total = Number(order.total);
            const pendingTotal = Number(pending.total);
            if (!Number.isFinite(total) || Math.abs(total - pendingTotal) > 0.02) {
                logger.warn('[WalletPayment] total divergente', { orderId, orderTotal: total, pendingTotal });
                await deps.Msg.edit(
                    ctx,
                    '❌ Valor inconsistente. Refaça o checkout.',
                    deps.Markup.inlineKeyboard([[{ text: '🛒 Carrinho', callback_data: CB.CART_VIEW }]])
                );
                return;
            }

            const saldo = UserWalletService.getBalance(user.id);
            if (saldo < total) {
                const falta = total - saldo;
                await deps.Msg.edit(
                    ctx,
                    `❌ <b>Saldo insuficiente na carteira</b>\n\n` +
                        `Carteira: R$ ${saldo.toFixed(2)}\n` +
                        `Total: R$ ${total.toFixed(2)}\n\n` +
                        (saldo > 0
                            ? `<i>Faltam R$ ${falta.toFixed(2)}. Pague com PIX ou aguarde créditos de pedidos anteriores.</i>`
                            : `<i>Quando um pedido falhar após pagamento, o valor volta como saldo aqui.</i>`),
                    {
                        parse_mode: 'HTML',
                        ...deps.Markup.inlineKeyboard([
                            [{ text: '📱 PIX', callback_data: CB.PAYMENT_PIX(orderId) }],
                            [{ text: '💳 Carteira', callback_data: 'user:wallet' }],
                            [{ text: '🛒 Carrinho', callback_data: CB.CART_VIEW }],
                        ]),
                    }
                );
                return;
            }

            if (!UserWalletService.reserve(user.id, total)) {
                throw new Error('reserve wallet balance failed');
            }

            try {
                await deps.prisma.order.update({
                    where: { id: orderId },
                    data: {
                        status: 'PAID',
                        payment_method: 'wallet_balance',
                        paid_at: new Date().toISOString(),
                    },
                });
                UserWalletService.confirmSpend(user.id, total, orderId);
                await deps.comprasPendentes.delete(key);
                await fulfillPaidOrder(ctx, order, pending, user, total, saldo, deps);
                logger.info('[WalletPayment] ok', { orderId, uid });
            } catch (e) {
                UserWalletService.cancelReserve(user.id, total);
                throw e;
            }
        });
    }
}

module.exports = new WalletPaymentService();
