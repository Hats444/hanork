#!/usr/bin/env node
'use strict';

require('../src/config/env');

const assert = require('assert');
const AffiliatePaymentService = require('../src/services/AffiliatePaymentService');
const { CB } = require('../src/telegram/callbacks/constants');

let failed = 0;
function test(name, fn) {
    return (async () => {
        try {
            await fn();
            console.log('  OK', name);
        } catch (e) {
            failed++;
            console.error('  FAIL', name + ':', e.message);
        }
    })();
}

function mockCtx() {
    return {
        from: { id: 800001 },
        chat: { id: 800001, type: 'private' },
        callbackQuery: { message: { message_id: 1 } },
    };
}

const tests = [];

tests.push(test('rejeita pedido inexistente no pending', async () => {
    const ctx = mockCtx();
    let edited = '';
    await AffiliatePaymentService.processAffiliatePayment(ctx, 'ord-missing', {
        cartKey: () => 'tg:800001',
        comprasPendentes: { get: async () => null },
        Msg: {
            edit: async (_ctx, text) => { edited = text; },
        },
        Markup: {
            inlineKeyboard: (rows) => ({ reply_markup: { inline_keyboard: rows } }),
        },
        prisma: {},
    });
    assert.ok(edited.includes('não encontrado') || edited.includes('expirado'));
}));

tests.push(test('rejeita saldo insuficiente', async () => {
    const ctx = mockCtx();
    const orderId = 'ord-aff-low';
    let edited = '';
    await AffiliatePaymentService.processAffiliatePayment(ctx, orderId, {
        cartKey: () => 'tg:800001',
        comprasPendentes: {
            get: async () => ({ orderId, total: 100, items: [{ name: 'X' }] }),
        },
        prisma: {
            user: {
                findUnique: async () => ({ id: 5, telegram_id: '800001' }),
            },
            order: {
                findUnique: async () => ({
                    id: orderId,
                    user_id: 5,
                    status: 'WAITING_PAYMENT',
                    total: 100,
                }),
            },
            affiliate: {
                findByUser: async () => ({ earnings: 10 }),
            },
        },
        Msg: {
            edit: async (_ctx, text) => { edited = text; },
        },
        Markup: {
            inlineKeyboard: (rows) => ({ reply_markup: { inline_keyboard: rows } }),
        },
    });
    assert.ok(edited.includes('insuficiente'));
}));

tests.push(test('CB.USER_AFFILIATE definido para teclados', async () => {
    assert.strictEqual(CB.USER_AFFILIATE, 'user:afiliado');
}));

Promise.all(tests).then(() => {
    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — affiliate payment\n');
    process.exit(failed ? 1 : 0);
});
