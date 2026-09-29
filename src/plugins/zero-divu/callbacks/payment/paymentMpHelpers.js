'use strict';

function orderMpReference(order) {
    if (!order) return null;
    return order.external_reference || order.id;
}

async function criarPagamentoMP(deps, orderId, total, telegramId) {
    const { prisma, MP } = deps;
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    const ref = orderMpReference(order) || orderId;
    const desc = `Pedido #${orderId.slice(-8)}`;
    let email = process.env.MP_PAYER_EMAIL || null;
    try {
        const user = await prisma.user.findUnique({ where: { telegram_id: String(telegramId) } });
        if (user?.email) email = user.email;
    } catch { /* ignore */ }
    return MP.pix(total, desc, ref, email);
}

async function criarCheckoutMP(deps, orderId, total, telegramId) {
    const { prisma, MP } = deps;
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    const ref = orderMpReference(order) || orderId;
    const desc = `Pedido #${orderId.slice(-8)}`;
    return MP.checkout(total, desc, ref);
}

module.exports = {
    orderMpReference,
    criarPagamentoMP,
    criarCheckoutMP,
};
