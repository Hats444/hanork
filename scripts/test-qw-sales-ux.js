#!/usr/bin/env node
'use strict';

/**
 * V4 Quick Wins QW-3, QW-8, QW-9 — config e menu destaque.
 */
require('../src/config/env');

const assert = require('assert');
const { createMenuKeyboards } = require('../src/telegram/menus/MenuKeyboards');
const {
    DEFAULT_INTERVAL_MS,
    abandonedCartMinutes,
} = require('../src/jobs/schedulers/abandonedCartScheduler');

const Menu = createMenuKeyboards({ LINKGP: 'https://t.me/example' }, { isAvailable: () => true });

let failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log('  OK', name);
    } catch (e) {
        failed++;
        console.error('  FAIL', name + ':', e.message);
    }
}

console.log('\n=== QW Sales/UX config ===\n');

test('QW-8 BOT_FEATURED_PRODUCT_ID configurado', () => {
    const id = parseInt(process.env.BOT_FEATURED_PRODUCT_ID || '', 10);
    assert.ok(id > 0, 'defina BOT_FEATURED_PRODUCT_ID no .env');
});

test('QW-8 menu principal inclui botão destaque', () => {
    const kb = Menu.principal(false, 17, {
        menuLabel: '⚡ Hanork Bot — R$ 49.90',
        callbackData: 'buy_15',
    });
    const rows = kb.reply_markup.inline_keyboard;
    assert.ok(rows.some((r) => r.some((b) => b.callback_data === 'buy_15')));
});

test('QW-9 abandoned cart 30min', () => {
    assert.strictEqual(abandonedCartMinutes(), 30);
    assert.strictEqual(DEFAULT_INTERVAL_MS, 30 * 60 * 1000);
});

test('QW-3 intro estática por padrão (IA opt-in 1)', () => {
    assert.notStrictEqual(process.env.HANORK_START_INTRO_AI, '1');
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — QW Sales/UX\n');
process.exit(failed ? 1 : 0);
