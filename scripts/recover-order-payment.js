#!/usr/bin/env node
'use strict';
/**
 * Verifica MP e recupera pagamento aprovado não processado.
 * Uso: node scripts/recover-order-payment.js <orderId>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const PaymentService = require('../src/modules/payment/PaymentService');
const SafeWebhookHandler = require('../src/modules/payment/SafeWebhookHandler');
const { connect } = require('../src/config/database-sqlite');

async function main() {
    const orderId = process.argv[2];
    if (!orderId) {
        console.error('Uso: node scripts/recover-order-payment.js <orderId>');
        process.exit(1);
    }

    const db = connect();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
        console.error('Pedido não encontrado:', orderId);
        process.exit(1);
    }

    console.log('Pedido:', order.id, order.status, 'R$', order.total, order.payment_method);

    const ref = order.external_reference || order.id;
    const mp = await PaymentService.findByReference(ref);
    if (!mp) {
        console.log('MP: nenhum pagamento encontrado para', ref);
        console.log('Status local:', order.status, '— cliente ainda não concluiu o pagamento no Mercado Pago.');
        process.exit(0);
    }

    console.log('MP:', mp.id, mp.status, 'R$', mp.transaction_amount, mp.payment_method_id || '');

    if (mp.status !== 'approved') {
        console.log('Pagamento MP ainda não aprovado — aguardar ou cliente refazer checkout.');
        process.exit(0);
    }

    if (order.status === 'DELIVERED' || order.status === 'PAID') {
        console.log('Pedido já pago localmente — nada a fazer.');
        process.exit(0);
    }

    const handler = new SafeWebhookHandler();
    const r = await handler.processPayment(String(mp.id), {
        id: mp.id,
        status: mp.status,
        external_reference: ref,
        transaction_amount: mp.transaction_amount,
        payment_method_id: mp.payment_method_id,
    }, null);

    console.log('Recover result:', JSON.stringify(r));
    const fresh = db.prepare('SELECT id, status, payment_id, paid_at FROM orders WHERE id = ?').get(orderId);
    console.log('Pedido após recover:', fresh);
    process.exit(r?.processed || r?.reason === 'already_paid' ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
