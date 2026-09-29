#!/usr/bin/env node
/**
 * Testes offline do sistema de callbacks (sem Telegram API)
 */
'use strict';

require('../src/config/env');

const assert = require('assert');
const {
    normalizeCallbackData,
    delegatePaymentNamespaceToLegacy,
    shouldDelegateToLegacyBotAction,
} = require('../src/telegram/callbacks/legacyPatterns');
const { registry } = require('../src/core/CallbackRegistry');
const { AllHandlers, LegacyMapping } = require('../src/core/UserHandlers');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  OK ${name}`);
    } catch (e) {
        failed++;
        console.error(`  FAIL ${name}:`, e.message);
    }
}

console.log('\n=== Normalização ===');
test('home -> menu:home', () => {
    assert.strictEqual(normalizeCallbackData('home'), 'menu:home');
});
test('cat -> catalog:view', () => {
    assert.strictEqual(normalizeCallbackData('cat'), 'catalog:view');
});
test('cart -> cart:view', () => {
    assert.strictEqual(normalizeCallbackData('cart'), 'cart:view');
});
test('buscar_btn -> search:open', () => {
    assert.strictEqual(normalizeCallbackData('buscar_btn'), 'search:open');
});
test('ck_ORDER -> payment:check:ORDER', () => {
    assert.strictEqual(normalizeCallbackData('ck_ORDER123'), 'payment:check:ORDER123');
});
test('aff_pay -> payment:aff', () => {
    assert.strictEqual(normalizeCallbackData('aff_pay_x'), 'payment:aff:x');
});
test('noop', () => {
    assert.strictEqual(normalizeCallbackData('noop'), 'noop');
});

console.log('\n=== Delegação pagamento (sem loop) ===');
test('payment:check -> check_', () => {
    assert.strictEqual(delegatePaymentNamespaceToLegacy('payment:check:ABC'), 'check_ABC');
});
test('payment:pix -> pp_', () => {
    assert.strictEqual(delegatePaymentNamespaceToLegacy('payment:pix:ABC'), 'pp_ABC');
});
test('menu:home não delega', () => {
    assert.strictEqual(delegatePaymentNamespaceToLegacy('menu:home'), null);
});

console.log('\n=== Delegação legacy bot.action ===');
test('help_sec_user delega', () => {
    assert.strictEqual(shouldDelegateToLegacyBotAction('help_sec_user'), true);
});
test('aff_wd_ok_1 delega', () => {
    assert.strictEqual(shouldDelegateToLegacyBotAction('aff_wd_ok_1'), true);
});
test('fin_daily delega', () => {
    assert.strictEqual(shouldDelegateToLegacyBotAction('fin_daily'), true);
});
test('payment_methods_ORDER delega', () => {
    assert.strictEqual(shouldDelegateToLegacyBotAction('payment_methods_ORDER'), true);
});
test('prod_edit_pg_0 delega', () => {
    assert.strictEqual(shouldDelegateToLegacyBotAction('prod_edit_pg_0'), true);
});
test('prod_del_pg_2 delega', () => {
    assert.strictEqual(shouldDelegateToLegacyBotAction('prod_del_pg_2'), true);
});
test('fs_nav_0 delega', () => {
    assert.strictEqual(shouldDelegateToLegacyBotAction('fs_nav_0'), true);
});
test('menu:home NÃO delega (registry)', () => {
    assert.strictEqual(shouldDelegateToLegacyBotAction('menu:home'), false);
});
test('saas_back delega', () => {
    assert.strictEqual(shouldDelegateToLegacyBotAction('saas_back'), true);
});
test('rate_ORDER_5 delega', () => {
    assert.strictEqual(shouldDelegateToLegacyBotAction('rate_ORDER_5'), true);
});
test('onb_confirm delega', () => {
    assert.strictEqual(shouldDelegateToLegacyBotAction('onb_confirm'), true);
});

console.log('\n=== Registry ===');
registry.clear();
for (const [p, h] of Object.entries(AllHandlers)) {
    registry.register(p, h);
}
test('todos AllHandlers registrados', () => {
    assert.strictEqual(registry.stats.registered, Object.keys(AllHandlers).length);
});
test('handler menu:home existe', () => {
    assert.ok(registry.handlers.has('menu:home'));
});
test('handler payment:aff:* existe', () => {
    assert.ok(registry.handlers.has('payment:aff:*'));
});
const CONTEXT_HANDLERS = new Set([
    'menu:home', 'catalog:view', 'cart:view', 'cart:clear', 'checkout:start', 'payment:aff:*',
]);

test('legacy mapping alvos existem', () => {
    for (const target of Object.values(LegacyMapping)) {
        const ok = registry.handlers.has(target) ||
            CONTEXT_HANDLERS.has(target) ||
            [...registry.handlers.keys()].some((k) => k.includes('*') && target.startsWith(k.replace(':*', ':')));
        assert.ok(ok, `sem handler: ${target}`);
    }
});

console.log('\n=== Módulos ===');
test('CheckoutService carrega', () => require('../src/services/CheckoutService'));
test('AffiliatePaymentService carrega', () => require('../src/services/AffiliatePaymentService'));
test('setup carrega', () => require('../src/telegram/callbacks/setup'));

console.log(`\n=== Resultado: ${passed} ok, ${failed} falhas ===\n`);
process.exit(failed > 0 ? 1 : 0);
