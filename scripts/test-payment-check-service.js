#!/usr/bin/env node
'use strict';

require('../src/config/env');

const assert = require('assert');
const { runManualPaymentCheck } = require('../src/services/PaymentCheckService');

let failed = 0;
async function test(name, fn) {
    try {
        await fn();
        console.log('  OK', name);
    } catch (e) {
        failed++;
        console.error('  FAIL', name + ':', e.message);
    }
}

function uiCapture() {
    const messages = [];
    let cbAnswered = false;
    return {
        messages,
        dismissCb: async (text) => {
            cbAnswered = true;
            if (text) messages.push({ type: 'cb', text });
        },
        notifyUser: async (text, { alert } = {}) => {
            if (!cbAnswered) messages.push({ type: 'cb', text, alert });
            else messages.push({ type: 'reply', text, alert });
        },
    };
}

async function run() {
    console.log('\n=== Payment check service (check_) ===\n');

    await test('pedido inexistente', async () => {
        const ui = uiCapture();
        const r = await runManualPaymentCheck(
            { from: { id: 1 } },
            'ord-x',
            {
                prisma: { order: { findUnique: async () => null } },
                bot: {},
                MP: {},
                comprasPendentes: { get: async () => null, delete: async () => {} },
                cartKey: () => 'k',
            },
            ui
        );
        assert.strictEqual(r.reason, 'not_found');
        assert.ok(ui.messages.some((m) => m.text.includes('não encontrado')));
    });

    await test('MP approved processa via SafeWebhookHandler mock', async () => {
        const ui = uiCapture();
        let processCalled = false;
        const order = {
            id: 'ord-ok',
            user_id: 5,
            status: 'WAITING_PAYMENT',
            total: 20,
            external_reference: 'ord-ok',
        };
        const r = await runManualPaymentCheck(
            { from: { id: 100 } },
            'ord-ok',
            {
                prisma: {
                    order: { findUnique: async () => order },
                    user: {
                        findUnique: async () => ({ id: 5, telegram_id: '100' }),
                    },
                },
                bot: {},
                MP: {
                    status: async (id) => ({
                        id: id || 'mp-99',
                        status: 'approved',
                        transaction_amount: 20,
                        payment_method_id: 'pix',
                    }),
                    search: async () => ({
                        id: 'mp-99',
                        status: 'approved',
                        transaction_amount: 20,
                        payment_method_id: 'pix',
                    }),
                },
                comprasPendentes: {
                    get: async () => null,
                    delete: async () => {},
                },
                cartKey: () => 'cart:100',
                safeWebhookHandler: {
                    processPayment: async () => {
                        processCalled = true;
                        return { processed: true, orderId: 'ord-ok' };
                    },
                    ensureDeliveryForOrder: async () => {},
                },
            },
            ui
        );
        assert.strictEqual(processCalled, true);
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.reason, 'processed');
    });

    await test('valor divergente não chama processPayment', async () => {
        let processCalled = false;
        const ui = uiCapture();
        const r = await runManualPaymentCheck(
            { from: { id: 101 } },
            'ord-bad',
            {
                prisma: {
                    order: {
                        findUnique: async () => ({
                            id: 'ord-bad',
                            user_id: 6,
                            status: 'WAITING_PAYMENT',
                            total: 100,
                        }),
                    },
                    user: { findUnique: async () => ({ id: 6, telegram_id: '101' }) },
                },
                bot: {},
                MP: {
                    status: async () => ({
                        id: 'mp-1',
                        status: 'approved',
                        transaction_amount: 1,
                    }),
                    search: async () => ({
                        id: 'mp-1',
                        status: 'approved',
                        transaction_amount: 1,
                    }),
                },
                comprasPendentes: { get: async () => null, delete: async () => {} },
                cartKey: () => 'k',
                safeWebhookHandler: {
                    processPayment: async () => {
                        processCalled = true;
                        return { processed: true };
                    },
                    ensureDeliveryForOrder: async () => {},
                },
            },
            ui
        );
        assert.strictEqual(processCalled, false);
        assert.strictEqual(r.reason, 'amount_mismatch');
    });

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — payment check service\n');
    process.exit(failed ? 1 : 0);
}

run();
