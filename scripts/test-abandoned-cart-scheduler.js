#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    runAbandonedCartCycle,
    DEFAULT_INTERVAL_MS,
} = require('../src/jobs/schedulers/abandonedCartScheduler');

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

const Markup = {
    inlineKeyboard: (rows) => ({ reply_markup: { inline_keyboard: rows } }),
};

async function run() {
    console.log('\n=== Abandoned cart scheduler ===\n');

    await test('intervalo padrão 30 min', async () => {
        assert.strictEqual(DEFAULT_INTERVAL_MS, 30 * 60 * 1000);
    });

    await test('envia mensagem e marca notificação', async () => {
        const sent = [];
        const marked = [];
        const deps = {
            dbRaw: () => ({
                prepare: () => ({
                    all: () => [{ user_id: 1, telegram_id: '111' }],
                }),
            }),
            prisma: {
                notification: {
                    wasSent: async () => false,
                    markSent: async (...args) => { marked.push(args); },
                },
                cart: {
                    getByTelegram: async () => [
                        { product_name: 'Prod A', quantity: 2, product_price: 5 },
                    ],
                },
            },
            bot: {
                telegram: {
                    sendMessage: async (chatId, text, opts) => {
                        sent.push({ chatId, text, opts });
                    },
                },
            },
            Markup,
            log: { info() {} },
        };

        await runAbandonedCartCycle(deps);
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0].chatId, '111');
        assert.ok(sent[0].text.includes('Prod A'));
        assert.ok(sent[0].opts.reply_markup.inline_keyboard[0][0].callback_data === 'cart');
        assert.strictEqual(marked.length, 1);
        assert.strictEqual(marked[0][2], 'cart_abandoned');
    });

    await test('pula se já notificado', async () => {
        let sent = 0;
        const deps = {
            dbRaw: () => ({
                prepare: () => ({ all: () => [{ user_id: 2, telegram_id: '222' }] }),
            }),
            prisma: {
                notification: { wasSent: async () => true, markSent: async () => {} },
                cart: { getByTelegram: async () => [{ product_name: 'X', quantity: 1, product_price: 1 }] },
            },
            bot: { telegram: { sendMessage: async () => { sent++; } } },
            Markup,
            log: { info() {} },
        };
        await runAbandonedCartCycle(deps);
        assert.strictEqual(sent, 0);
    });

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — abandoned cart scheduler\n');
    process.exit(failed ? 1 : 0);
}

run();
