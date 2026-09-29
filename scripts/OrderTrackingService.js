'use strict';

const { Markup } = require('telegraf');
const { prisma } = require('../config/database');
const ReviewService = require('./ReviewService');
const ResendService = require('./ResendService');

const STATUS_ICONS = {
    CREATED: '🆕 Criado',
    WAITING_PAYMENT: '⏳ Aguardando pagamento',
    PAID: '💰 Pago — preparando entrega',
    PROCESSING: '📦 Em processamento',
    DELIVERED: '✅ Entregue',
    FAILED: '❌ Cancelado',
    CANCELLED: '❌ Cancelado',
};

async function buildTrackingText(orders, { max = 3 } = {}) {
    let txt = '<b>📦 Rastreamento de pedidos</b>\n\n';
    for (const o of orders.slice(0, max)) {
        const items = await prisma.orderItem.findMany({ where: { order_id: o.id } });
        const nomes = (
            await Promise.all(
                items.map(async (i) => {
                    const p = await prisma.product.findUnique({ where: { id: i.product_id } });
                    return p?.name || '?';
                })
            )
        ).join(', ');

        txt += `🔑 <b>#${o.id.slice(-8)}</b>\n`;
        txt += `📌 ${STATUS_ICONS[o.status] || o.status}\n`;
        txt += `📦 ${nomes || '—'}\n`;
        txt += `💰 R$ ${o.total.toFixed(2)}\n`;
        txt += `📅 ${new Date(o.created_at).toLocaleDateString('pt-BR')}\n`;
        if (o.delivered_at) {
            txt += `🎉 Entregue em: ${new Date(o.delivered_at).toLocaleDateString('pt-BR')}\n`;
        }
        if (o.payment_method) txt += `💳 ${String(o.payment_method).toUpperCase()}\n`;

        if (o.status === 'DELIVERED') {
            const reviewed = await ReviewService.isOrderReviewed(o.id);
            txt += reviewed ? '⭐ Avaliação: enviada\n' : '⭐ Avaliação: pendente\n';
            const cd = ResendService.getCooldownInfo(o.id);
            txt += cd.onCooldown ? '🔄 Reenvio: aguarde 24h\n' : '🔄 Reenvio: disponível\n';
        }
        txt += '\n';
    }
    return txt;
}

async function buildTrackingKeyboard(orders) {
    const btns = [];
    const delivered = orders.filter((o) => o.status === 'DELIVERED');
    if (delivered.length) {
        const pick = delivered.find((o) => !ResendService.getCooldownInfo(o.id).onCooldown) || delivered[0];
        if (!ResendService.getCooldownInfo(pick.id).onCooldown) {
            btns.push([{ text: '🔄 Reenviar produto', callback_data: `resend_${pick.id}` }]);
        }
        const toRate = [];
        for (const o of delivered.slice(0, 3)) {
            if (!(await ReviewService.isOrderReviewed(o.id))) toRate.push(o);
        }
        if (toRate.length === 1) {
            btns.push([{ text: '⭐ Avaliar compra', callback_data: `rate_${toRate[0].id}_5` }]);
        } else if (toRate.length > 1) {
            btns.push([{ text: '🔄 Ver pedidos p/ reenviar', callback_data: 'order:resend_list' }]);
        }
    }
    if (orders.some((o) => o.status === 'WAITING_PAYMENT')) {
        btns.push([{ text: '💳 Ir ao pagamento', callback_data: 'checkout' }]);
    }
    btns.push(
        [{ text: '🔄 Atualizar', callback_data: 'order:track' }],
        [{ text: '🏠 Menu', callback_data: 'home' }]
    );
    return Markup.inlineKeyboard(btns);
}

module.exports = {
    STATUS_ICONS,
    buildTrackingText,
    buildTrackingKeyboard,
};
