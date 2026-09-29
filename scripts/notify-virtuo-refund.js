#!/usr/bin/env node
'use strict';
const root = require('path').join(__dirname, '..');
process.chdir(root);
require('dotenv').config({ path: require('path').join(root, '.env') });
const { Telegraf } = require('telegraf');
const { prisma } = require(require('path').join(root, 'src/config/database-sqlite'));
const VirtuoOrderRepository = require(require('path').join(
    root,
    'src/modules/virtuo/repositories/virtuoOrderRepository'
));
const { refundUserLine } = require(require('path').join(
    root,
    'src/modules/virtuo/services/virtuoFailureRecoveryService'
));

const orderId = process.argv[2];
const reason = process.argv[3] || 'out_of_stock';
if (!orderId) {
    console.error('Usage: node scripts/notify-virtuo-refund.js <hanork-order-id> [reason]');
    process.exit(1);
}

(async () => {
    const token = process.env.BOT_TOKEN || process.env.TOKEN_TELEGRAM;
    if (!token) throw new Error('BOT_TOKEN missing');

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    const vo = VirtuoOrderRepository.findByHanorkOrderId(orderId);
    const user = order?.user_id
        ? await prisma.user.findUnique({ where: { id: order.user_id } })
        : null;
    const telegramId = vo?.telegram_id || user?.telegram_id;
    if (!telegramId) throw new Error('telegram_id not found');

    const ref = `#${String(orderId).slice(-8)}`;
    const total = Number(order?.total ?? vo?.sale_price);
    const line = refundUserLine({ ok: true, method: 'mercadopago' }, total);
    const reasonTxt =
        reason === 'out_of_stock'
            ? 'Não havia números disponíveis para o país escolhido.'
            : 'Não foi possível concluir a reserva do número.';

    const text =
        `<b>♻️ Reembolso — Números SMS</b>\n\n` +
        `Pedido <b>${ref}</b>\n` +
        `${reasonTxt}` +
        line +
        `\n\n<i>Escolha outro país ou tente novamente mais tarde.</i>`;

    const bot = new Telegraf(token);
    await bot.telegram.sendMessage(Number(telegramId), text, { parse_mode: 'HTML' });
    console.log('notified', telegramId);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
