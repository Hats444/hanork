#!/usr/bin/env node
'use strict';

/**
 * B2 U2–U4 — Hanork Gateway: predição, telemetria, ActionRegistry, legacy WARN.
 */
require('../src/config/env');

const assert = require('assert');
const hanorkGateway = require('../src/core/hanorkGateway');
const { registry } = require('../src/core/CallbackRegistry');
const { AllHandlers } = require('../src/core/UserHandlers');

registry.clear();
for (const [pattern, handler] of Object.entries(AllHandlers)) {
    registry.register(pattern, handler);
}

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

function predict(raw) {
    return hanorkGateway.predictCallbackRoute(raw, registry);
}

console.log('\n=== Hanork Gateway (B2 U2) ===\n');

test('pp_ → legacy (bot.action legado)', () => {
    const p = predict('pp_ord-abc');
    assert.strictEqual(p.route, 'legacy');
    assert.strictEqual(p.critical, true);
});

test('payment:pix:* → legacy_payment', () => {
    const p = predict('payment:pix:ord-1');
    assert.strictEqual(p.route, 'legacy_payment');
});

test('payment:aff:* → registry', () => {
    const p = predict('payment:aff:ord-1');
    assert.strictEqual(p.route, 'registry');
});

test('flash_sales normalizado → registry', () => {
    const p = predict('flash_sales');
    assert.strictEqual(p.route, 'registry');
    assert.strictEqual(p.normalized, 'flash:sales');
});

test('fs_buy_* → legacy', () => {
    const p = predict('fs_buy_1_2');
    assert.strictEqual(p.route, 'legacy');
});

test('p_10 → legacy', () => {
    const p = predict('p_10');
    assert.strictEqual(p.route, 'legacy');
});

test('home → registry (menu:home)', () => {
    const p = predict('home');
    assert.strictEqual(p.route, 'registry');
    assert.strictEqual(p.normalized, 'menu:home');
});

test('a_panel → legacy', () => {
    const p = predict('a_panel');
    assert.strictEqual(p.route, 'legacy');
});

test('callback desconhecido → legacy_action (next)', () => {
    const p = predict('totally_unknown_cb_xyz');
    assert.strictEqual(p.route, 'legacy_action');
});

test('telemetria incrementa sem mismatch quando predição = rota', () => {
    hanorkGateway.resetStats();
    process.env.HANORK_GATEWAY_TELEMETRY = '1';

    const raw = 'home';
    const prediction = predict(raw);
    hanorkGateway.recordCallbackRoute('registry', raw, prediction);

    const stats = hanorkGateway.getStats();
    assert.strictEqual(stats.registry, 1);
    assert.strictEqual(stats.mismatch, 0);
});

test('telemetria detecta mismatch', () => {
    hanorkGateway.resetStats();
    process.env.HANORK_GATEWAY_TELEMETRY = '1';

    hanorkGateway.recordCallbackRoute('legacy', 'pp_x', {
        route: 'registry',
        intentId: 'payment:pix',
    });

    const stats = hanorkGateway.getStats();
    assert.strictEqual(stats.mismatch, 1);
    assert.strictEqual(stats.legacy, 1);
});

test('isCriticalIntent — payment e admin', () => {
    assert.strictEqual(hanorkGateway.isCriticalIntent('payment:pix:legacy'), true);
    assert.strictEqual(hanorkGateway.isCriticalIntent('admin:panel'), true);
    assert.strictEqual(hanorkGateway.isCriticalIntent('help:faq'), false);
});

test('resolve — callback home', () => {
    const intent = hanorkGateway.resolve(
        { callbackQuery: { data: 'home' } },
        registry
    );
    assert.strictEqual(intent.source, 'callback');
    assert.strictEqual(intent.route, 'registry');
});

test('resolve — deep link buy_', () => {
    const intent = hanorkGateway.resolve({
        message: { text: '/start buy_42' },
    });
    assert.strictEqual(intent.source, 'deep_link');
    assert.strictEqual(intent.action, 'buy');
    assert.strictEqual(intent.params.productId, '42');
});

test('resolve — slash /catalogo', () => {
    const intent = hanorkGateway.resolve({
        message: { text: '/catalogo' },
    });
    assert.strictEqual(intent.source, 'slash');
    assert.strictEqual(intent.action, 'catalogo');
});

test('getStats mode matches HANORK_GATEWAY env', () => {
    hanorkGateway.resetStats();
    const stats = hanorkGateway.getStats();
    const expected = hanorkGateway.isFullGatewayEnabled() ? 'gateway' : 'telemetry';
    assert.strictEqual(stats.mode, expected);
});

test('createHanorkGatewayMiddleware exportado', () => {
    assert.strictEqual(typeof hanorkGateway.createHanorkGatewayMiddleware, 'function');
    assert.strictEqual(typeof hanorkGateway.markHanorkGatewayReady, 'function');
});

test('ActionRegistry — isRegisteredAction', () => {
    assert.strictEqual(hanorkGateway.isRegisteredAction('cart'), true);
    assert.strictEqual(hanorkGateway.isRegisteredAction('invalid_xyz'), false);
});

test('ActionRegistry — formatForPlanner inclui cart', () => {
    const text = hanorkGateway.formatForPlanner();
    assert.ok(text.includes('cart'));
});

test('classifyLegacyFamily — payment pp_', () => {
    assert.strictEqual(hanorkGateway.classifyLegacyFamily('pp_ord-1'), 'payment');
    assert.strictEqual(hanorkGateway.classifyLegacyFamily('a_panel'), 'admin');
});

test('legacyOffReady — false com pouca amostra', () => {
    hanorkGateway.resetStats();
    assert.strictEqual(hanorkGateway.isLegacyOffReady(), false);
});

test('getStats — legacyOffReady após amostra baixa legacy', () => {
    hanorkGateway.resetStats();
    for (let i = 0; i < 210; i++) {
        hanorkGateway.recordCallbackRoute('registry', 'home', { route: 'registry', intentId: 'menu:home' });
    }
    for (let i = 0; i < 2; i++) {
        hanorkGateway.recordCallbackRoute('legacy', 'pp_x', { route: 'legacy', intentId: 'payment:pix' });
    }
    const stats = hanorkGateway.getStats();
    assert.ok(stats.legacyRate < 0.01);
    assert.strictEqual(stats.legacyOffReady, true);
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — Hanork Gateway\n');
process.exit(failed ? 1 : 0);
