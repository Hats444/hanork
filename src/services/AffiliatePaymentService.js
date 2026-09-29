'use strict';

const logger = require('../config/logger');
const { withLock } = require('../infrastructure/DistributedStateManager');
const UserService = require('../modules/user/UserService');
const QueueHelpers = require('../modules/queue/QueueHelpers');
const { eventBus, DomainEvents } = require('../infrastructure');
const { CB } = require('../telegram/callbacks/constants');

class AffiliatePaymentService {
    async processAffiliatePayment(ctx, orderId, deps) {
        const uid = ctx.from?.id;
        if (!uid) throw new Error('user id missing');

        return withLock(`payment:aff:${orderId}`, 15000, async () => {
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
                await deps.Msg.edit(ctx, '❌ Pedido inválido.', deps.Markup.inlineKeyboard([[{ text: '🏠 Menu', callback_data: CB.MENU_HOME }]]));
                return;
            }
            if (order.status !== 'WAITING_PAYMENT') {
                await deps.Msg.edit(ctx, '❌ Este pedido já foi processado.', deps.Markup.inlineKeyboard([[{ text: '🏠 Menu', callback_data: CB.MENU_HOME }]]));
                return;
            }

            const total = Number(order.total);
            const pendingTotal = Number(pending.total);
            if (!Number.isFinite(total) || Math.abs(total - pendingTotal) > 0.02) {
                logger.warn('[AffiliatePaymentService] total divergente', { orderId, orderTotal: total, pendingTotal });
                await deps.Msg.edit(ctx, '❌ Valor do pedido inconsistente. Refaça o checkout.', deps.Markup.inlineKeyboard([[{ text: '🛒 Carrinho', callback_data: CB.CART_VIEW }]]));
                return;
            }

            const aff = await deps.prisma.affiliate.findByUser(user.id);
            const saldo = aff ? Math.max(0, aff.earnings || 0) : 0;

            if (saldo < total) {
                const falta = total - saldo;
                await deps.Msg.edit(
                    ctx,
                    `❌ <b>Saldo insuficiente</b>\n\n` +
                    `Saldo afiliado: R$ ${saldo.toFixed(2)}\n` +
                    `Total do pedido: R$ ${total.toFixed(2)}\n\n` +
                    (saldo > 0
                        ? `<i>É necessário saldo para cobrir o pedido inteiro. Faltam R$ ${falta.toFixed(2)}.</i>`
                        : `<i>Indique clientes para acumular saldo ou pague com PIX/cartão.</i>`),
                    {
                        parse_mode: 'HTML',
                        ...deps.Markup.inlineKeyboard([
                            [{ text: '💰 Rendimentos', callback_data: 'user:rendimentos' }],
                            [{ text: '📱 PIX', callback_data: CB.PAYMENT_PIX(orderId) }],
                            [{ text: '🛒 Carrinho', callback_data: CB.CART_VIEW }],
                        ]),
                    }
                );
                return;
            }

            if (!(await UserService.reserveAffiliateBalance(user.id, total))) {
                throw new Error('reserve affiliate balance failed');
            }

            try {
                await deps.prisma.order.update({
                    where: { id: orderId },
                    data: {
                        status: 'PAID',
                        payment_method: 'affiliate_balance',
                        paid_at: new Date().toISOString(),
                    },
                });
                await UserService.confirmAffiliateReserve(user.id, total);
                await deps.comprasPendentes.delete(key);

                const { isSmmHanorkOrder } = require('../modules/smm/helpers/smmPendingHelper');

                if (isSmmHanorkOrder(orderId) || pending.orderKind === 'smm') {
                    await QueueHelpers.scheduleSmmFulfill(orderId, user.telegram_id, user.id);
                    await eventBus.emit(DomainEvents.ORDER_PAID, {
                        orderId,
                        userId: user.id,
                        total,
                        items: [],
                        orderKind: 'smm',
                        paymentId: `aff-${orderId}`,
                        tenantId: order.tenant_id || 'default',
                    });
                    await deps.Msg.edit(
                        ctx,
                        `✅ <b>Pago com saldo afiliado</b>\n\n` +
                        `💰 R$ ${total.toFixed(2)} debitados do seu saldo.\n` +
                        `💵 Saldo restante: <b>R$ ${(saldo - total).toFixed(2)}</b>\n\n` +
                        `<i>Pedido SMM em processamento no Hanork.</i>`,
                        {
                            parse_mode: 'HTML',
                            ...deps.Markup.inlineKeyboard([
                                [{ text: '📱 Meus pedidos SMM', callback_data: 'smm:ord' }],
                                [{ text: '🏠 Menu', callback_data: CB.MENU_HOME }],
                            ]),
                        }
                    );
                } else {
                const { isVirtuoHanorkOrder } = require('../modules/virtuo/helpers/virtuoPendingHelper');

                if (isVirtuoHanorkOrder(orderId) || pending.orderKind === 'virtuo') {
                    await QueueHelpers.scheduleVirtuoFulfill(orderId, user.telegram_id, user.id);
                    await eventBus.emit(DomainEvents.ORDER_PAID, {
                        orderId,
                        userId: user.id,
                        total,
                        items: [],
                        orderKind: 'virtuo',
                        paymentId: `aff-${orderId}`,
                        tenantId: order.tenant_id || 'default',
                    });
                    await deps.Msg.edit(
                        ctx,
                        `✅ <b>Pago com saldo afiliado</b>\n\n` +
                        `💰 R$ ${total.toFixed(2)} debitados do seu saldo.\n` +
                        `💵 Saldo restante: <b>R$ ${(saldo - total).toFixed(2)}</b>\n\n` +
                        `<i>Reservando seu número SMS…</i>`,
                        {
                            parse_mode: 'HTML',
                            ...deps.Markup.inlineKeyboard([
                                [{ text: '📱 Números SMS', callback_data: 'virtuo:home' }],
                                [{ text: '🏠 Menu', callback_data: CB.MENU_HOME }],
                            ]),
                        }
                    );
                } else {
                await QueueHelpers.scheduleDelivery(orderId, user.telegram_id, pending.items, user.id);
                await eventBus.emit(DomainEvents.ORDER_PAID, {
                    orderId,
                    userId: user.id,
                    total,
                    items: pending.items,
                    paymentId: `aff-${orderId}`,
                    tenantId: order.tenant_id || 'default',
                });

                await deps.Msg.edit(
                    ctx,
                    `✅ <b>Pago com saldo afiliado</b>\n\n` +
                    `💰 R$ ${total.toFixed(2)} debitados do seu saldo.\n` +
                    `💵 Saldo restante: <b>R$ ${(saldo - total).toFixed(2)}</b>\n\n` +
                    `<i>Entrega automática após confirmação.</i>`,
                    {
                        parse_mode: 'HTML',
                        ...deps.Markup.inlineKeyboard([
                            [{ text: '📋 Meus pedidos', callback_data: 'order:list' }],
                            [{ text: '🏠 Menu', callback_data: CB.MENU_HOME }],
                        ]),
                    }
                );
                }
                }
                logger.info('[AffiliatePaymentService] ok', { orderId, uid });
            } catch (e) {
                await UserService.cancelAffiliateReserve(user.id, total);
                throw e;
            }
        });
    }
}

module.exports = new AffiliatePaymentService();
