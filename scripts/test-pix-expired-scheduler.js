#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    runPixExpiredNotificationCycle,
    DEFAULT_INTERVAL_MS,
} = require('../src/jobs/schedulers/pixExpiredNotificationScheduler');

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
    console.log('\n=== PIX expired notification scheduler ===\n');

    await test('intervalo padrão 30 min', async () => {
        assert.strictEqual(DEFAULT_INTERVAL_MS, 1800000);
    });

    await test('notifica e marca pix_expired', async () => {
        const sent = [];
        const marked = [];
        const orderId = 'order-pix-expire-99';
        const deps = {
            prisma: {
                pendingPurchase: {
                    getExpiredPix: async () => [{
                        user_id: 3,
                        telegram_id: '333',
                        order_id: orderId,
                        total: 25.5,
                    }],
                },
                notification: {
                    wasSent: async () => false,
                    markSent: async (...args) => { marked.push(args); },
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

        await runPixExpiredNotificationCycle(deps);
        assert.strictEqual(sent.length, 1);
        assert.ok(sent[0].text.includes('PIX expirou'));
        const kb = sent[0].opts.reply_markup.inline_keyboard;
        assert.ok(kb[0][0].callback_data === `pp_${orderId}`);
        assert.strictEqual(marked[0][2], 'pix_expired');
    });

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — PIX expired scheduler\n');
    process.exit(failed ? 1 : 0);
}

run();
