#!/usr/bin/env node
'use strict';

require('../src/config/env');

const assert = require('assert');
const CheckoutService = require('../src/services/CheckoutService');

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

function mockCtx(uid = 900001) {
    return {
        from: { id: uid },
        chat: { id: uid, type: 'private' },
        callbackQuery: { message: { message_id: 1 } },
        reply: async () => ({ message_id: 2 }),
    };
}

function baseMsg() {
    return {
        reply: async () => ({ messageId: 1 }),
        edit: async () => ({ messageId: 1 }),
    };
}

async function run() {
    console.log('\n=== Checkout service ===\n');

    await test('bloqueia checkout em grupo', async () => {
        const ctx = mockCtx(900010);
        ctx.chat = { id: -100, type: 'supergroup' };
        ctx.answerCbQuery = async () => {};
        const r = await CheckoutService.processCheckout(ctx, {
            cartKey: () => 'u:10',
            Msg: baseMsg(),
            bot: { telegram: { getMe: async () => ({ username: 'hanork_test_bot' }) } },
        });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.reason, 'group');
    });

    await test('exige usuário identificado', async () => {
        const ctx = mockCtx(900011);
        ctx.from = null;
        let replied = false;
        const r = await CheckoutService.processCheckout(ctx, {
            cartKey: () => null,
            Msg: { reply: async () => { replied = true; } },
        });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.reason, 'no_user');
        assert.strictEqual(replied, true);
    });

    await test('carrinho vazio retorna empty_cart', async () => {
        const ctx = mockCtx(900012);
        const r = await CheckoutService.processCheckout(ctx, {
            cartKey: () => 'tg:900012',
            prisma: {
                user: {
                    findUnique: async () => ({ id: 12, telegram_id: '900012' }),
                },
                order: { findUnique: async () => null },
            },
            comprasPendentes: {
                get: async () => null,
                delete: async () => {},
            },
            checkCheckoutCooldown: async () => ({ allowed: true }),
            Cart: {
                items: async () => [],
                totalWithDiscount: async () => 0,
            },
            Msg: baseMsg(),
            createOrder: async () => { throw new Error('should not create'); },
        });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.reason, 'empty_cart');
    });

    await test('reutiliza pedido WAITING_PAYMENT existente', async () => {
        const ctx = mockCtx(900013);
        const orderId = 'ord-pending-abc12345';
        let shown = false;
        const r = await CheckoutService.processCheckout(ctx, {
            cartKey: () => 'tg:900013',
            prisma: {
                user: {
                    findUnique: async () => ({ id: 13, telegram_id: '900013' }),
                },
                order: {
                    findUnique: async () => ({
                        id: orderId,
                        status: 'WAITING_PAYMENT',
                        total: 49.9,
                    }),
                },
            },
            comprasPendentes: {
                get: async () => ({ orderId, total: 49.9 }),
            },
            checkCheckoutCooldown: async () => ({ allowed: true }),
            getAffSaldo: async () => 0,
            Msg: {
                ...baseMsg(),
                edit: async () => { shown = true; return { messageId: 1 }; },
            },
            Menu: {
                pagamento: () => ({ reply_markup: { inline_keyboard: [] } }),
            },
        });
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.reason, 'existing_pending');
        assert.strictEqual(shown, true);
    });

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — checkout service\n');
    process.exit(failed ? 1 : 0);
}

run();
