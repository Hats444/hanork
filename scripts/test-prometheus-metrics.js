#!/usr/bin/env node
'use strict';

/**
 * SP-4 — métricas Prometheus em /metrics
 */
const assert = require('assert');
const { formatPrometheus } = require('../src/modules/health/prometheusFormat');

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

console.log('\n=== Prometheus metrics (SP-4) ===\n');

test('formatPrometheus inclui TYPE e valor', () => {
    const out = formatPrometheus([
        { name: 'hanork_test_gauge', value: 42, type: 'gauge', help: 'Test metric' },
    ]);
    assert.ok(out.includes('# TYPE hanork_test_gauge gauge'));
    assert.ok(out.includes('hanork_test_gauge 42'));
});

test('formatPrometheus labels', () => {
    const out = formatPrometheus([
        { name: 'hanork_bull_queue_waiting', value: 3, labels: { queue: 'delivery:products' }, type: 'gauge' },
    ]);
    assert.ok(out.includes('queue="delivery:products"'));
    assert.ok(out.includes(' 3'));
});

test('getPrometheusText retorna string', async () => {
    require('../src/config/env');
    const HealthCheck = require('../src/modules/health/HealthCheck');
    const text = await HealthCheck.getPrometheusText();
    assert.ok(typeof text === 'string');
    assert.ok(text.includes('hanork_bot_uptime_seconds'));
    assert.ok(text.includes('hanork_sqlite_busy_total'));
    assert.ok(text.includes('hanork_stuck_paid_orders'));
    assert.ok(text.includes('hanork_gateway_registry_total'));
    assert.ok(text.includes('hanork_gateway_legacy_total'));
    assert.ok(text.includes('hanork_boot_duration_seconds'));
    assert.ok(text.includes('hanork_boot_complete'));
});

test('gateway stats após telemetria', () => {
    const gw = require('../src/core/hanorkGateway');
    gw.resetStats();
    process.env.HANORK_GATEWAY_TELEMETRY = '1';
    gw.recordCallbackRoute('registry', 'home', { route: 'registry', intentId: 'menu:home' });
    const stats = gw.getStats();
    assert.strictEqual(stats.registry, 1);
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — Prometheus metrics\n');
process.exit(failed ? 1 : 0);
