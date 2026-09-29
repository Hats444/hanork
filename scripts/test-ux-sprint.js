#!/usr/bin/env node
'use strict';

/** SP-6 / SP-7 — menu V4 e checkout loading callbacks */
const assert = require('assert');

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

console.log('\n=== UX Sprint (SP-6/7) ===\n');

test('menu V4 tem 6 linhas de botão (sem destaque)', () => {
    process.env.HANORK_MENU_V4 = '1';
    delete require.cache[require.resolve('../src/telegram/menus/MenuKeyboards')];
    const { createMenuKeyboards } = require('../src/telegram/menus/MenuKeyboards');
    const Menu = createMenuKeyboards({ LINKGP: 'https://t.me/x' }, { isAvailable: () => true });
    const kb = Menu.principal(false, 5, null);
    assert.strictEqual(kb.reply_markup.inline_keyboard.length, 4);
    const labels = kb.reply_markup.inline_keyboard.flat().map((b) => b.text);
    assert.ok(labels.some((t) => t.includes('Loja')));
    assert.ok(!labels.some((t) => t.includes('Favoritos')));
    assert.ok(!labels.some((t) => t.includes('Assistente')));
});

test('minhaConta V4 inclui favoritos e assistente', () => {
    const { createMenuKeyboards } = require('../src/telegram/menus/MenuKeyboards');
    const Menu = createMenuKeyboards({ LINKGP: 'https://t.me/x' }, { isAvailable: () => true });
    const kb = Menu.minhaConta(false);
    const labels = kb.reply_markup.inline_keyboard.flat().map((b) => b.text);
    assert.ok(labels.some((t) => t.includes('Favoritos')));
    assert.ok(labels.some((t) => t.includes('Assistente')));
});

test('checkout:processing registrado em constants', () => {
    const { CB } = require('../src/telegram/callbacks/constants');
    assert.strictEqual(CB.CHECKOUT_PROCESSING, 'checkout:processing');
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — UX sprint\n');
process.exit(failed ? 1 : 0);
