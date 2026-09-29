#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    runPixPendingReminderCycle,
    reminderAfterMinutes,
} = require('../src/jobs/schedulers/pixPendingReminderScheduler');

const Markup = {
    inlineKeyboard: (rows) => ({ reply_markup: { inline_keyboard: rows } }),
};

async function run() {
    assert.strictEqual(reminderAfterMinutes(), 15);

    const sent = [];
    const marked = [];
    const orderId = 'order-pix-remind-1';
    await runPixPendingReminderCycle({
        prisma: {
            pendingPurchase: {
                getPendingPixForReminder: () => [{
                    user_id: 5,
                    telegram_id: '555',
                    order_id: orderId,
                    total: 49.9,
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
    });

    assert.strictEqual(sent.length, 1);
    assert.ok(sent[0].text.includes('aguardando pagamento'));
    assert.strictEqual(marked[0][2], 'pix_pending_reminder');
    console.log('test-pix-pending-reminder.js OK');
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
