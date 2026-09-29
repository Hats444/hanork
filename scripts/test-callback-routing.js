#!/usr/bin/env node
'use strict';

/**
 * Garante roteamento crítico: pagamento legado, flash/favoritos no registry, sem órfãos.
 */
require('../src/config/env');

const assert = require('assert');
const {
    normalizeCallbackData,
    delegatePaymentNamespaceToLegacy,
    shouldDelegateToLegacyBotAction,
} = require('../src/telegram/callbacks/legacyPatterns');
const { AllHandlers } = require('../src/core/UserHandlers');

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

function effectiveRoute(raw) {
    let data = normalizeCallbackData(raw) || raw;
    const pay = delegatePaymentNamespaceToLegacy(data);
    if (pay) data = pay;
    if (shouldDelegateToLegacyBotAction(data)) return { route: 'legacy', data };
    if (AllHandlers[data] || data.startsWith('menu:') || data.startsWith('catalog:')) {
        return { route: 'registry', data };
    }
    for (const key of Object.keys(AllHandlers)) {
        if (!key.includes('*')) continue;
        const prefix = key.replace(':*', ':');
        if (data.startsWith(prefix)) return { route: 'registry', data, pattern: key };
    }
    return { route: 'unknown', data };
}

console.log('\n=== Callback routing (crítico) ===\n');

test('flash_sales → registry (flash:sales)', () => {
    const n = normalizeCallbackData('flash_sales');
    assert.strictEqual(n, 'flash:sales');
    const r = effectiveRoute('flash_sales');
    assert.strictEqual(r.route, 'registry');
    assert.strictEqual(shouldDelegateToLegacyBotAction('flash_sales'), false);
    assert.strictEqual(shouldDelegateToLegacyBotAction(n), false);
});

test('meus_favoritos → registry (user:favoritos)', () => {
    const n = normalizeCallbackData('meus_favoritos');
    assert.strictEqual(n, 'user:favoritos');
    const r = effectiveRoute('meus_favoritos');
    assert.strictEqual(r.route, 'registry');
});

test('fs_buy_* permanece legado', () => {
    assert.strictEqual(shouldDelegateToLegacyBotAction('fs_buy_1_2'), true);
    const r = effectiveRoute('fs_buy_1_2');
    assert.strictEqual(r.route, 'legacy');
});

test('pp_ e check_ permanecem legado', () => {
    assert.strictEqual(effectiveRoute('pp_ord-1').route, 'legacy');
    assert.strictEqual(effectiveRoute('check_ord-1').route, 'legacy');
    assert.strictEqual(effectiveRoute('payment:pix:ord-1').route, 'legacy');
    assert.strictEqual(effectiveRoute('payment:check:ord-1').route, 'legacy');
});

test('payment:aff:* permanece registry', () => {
    const r = effectiveRoute('payment:aff:ord-1');
    assert.strictEqual(r.route, 'registry');
    assert.strictEqual(r.pattern, 'payment:aff:*');
});

test('catálogo legado p_* e cat_f_* → legacy', () => {
    assert.strictEqual(effectiveRoute('p_10').route, 'legacy');
    assert.strictEqual(effectiveRoute('cat_f_zip_0').route, 'legacy');
    assert.strictEqual(effectiveRoute('home_user').route, 'legacy');
});

test('home/cat normalizados → registry', () => {
    assert.strictEqual(effectiveRoute('home').route, 'registry');
    assert.strictEqual(effectiveRoute('home').data, 'menu:home');
    assert.strictEqual(effectiveRoute('cat').route, 'registry');
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — callback routing\n');
process.exit(failed ? 1 : 0);
