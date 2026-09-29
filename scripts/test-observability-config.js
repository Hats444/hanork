#!/usr/bin/env node
'use strict';

/**
 * SP-8 — smoke da stack observability (sem Docker obrigatório).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

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

console.log('\n=== Observability config (SP-8) ===\n');

test('docker-compose.yml existe', () => {
    const p = path.join(root, 'observability/docker-compose.yml');
    assert.ok(fs.existsSync(p));
    const y = fs.readFileSync(p, 'utf8');
    assert.ok(y.includes('prometheus'));
    assert.ok(y.includes('grafana'));
});

test('prometheus scrape /metrics', () => {
    const y = fs.readFileSync(path.join(root, 'observability/prometheus/prometheus.yml'), 'utf8');
    assert.ok(y.includes('3000') || y.includes('host.docker.internal'));
    assert.ok(y.includes('metrics') || y.includes('hanork'));
    assert.ok(y.includes('rule_files'), 'prometheus.yml deve carregar rule_files');
    assert.ok(y.includes('hanork-alerts.yml'));
});

test('regras de alerta P5-3 stuck orders', () => {
    const rules = fs.readFileSync(
        path.join(root, 'observability/prometheus/rules/hanork-alerts.yml'),
        'utf8'
    );
    assert.ok(rules.includes('HanorkStuckPaidOrders'));
    assert.ok(rules.includes('hanork_stuck_paid_orders > 0'));
    assert.ok(rules.includes('HanorkStuckDeliveringOrders'));
});

test('Grafana alert provisioning P5-3', () => {
    const p = path.join(root, 'observability/grafana/provisioning/alerting/hanork-alerts.yml');
    assert.ok(fs.existsSync(p));
    const y = fs.readFileSync(p, 'utf8');
    assert.ok(y.includes('hanork-stuck-paid-orders'));
    assert.ok(y.includes('hanork_stuck_paid_orders'));
});

test('datasource Prometheus com uid fixo', () => {
    const y = fs.readFileSync(
        path.join(root, 'observability/grafana/provisioning/datasources/prometheus.yml'),
        'utf8'
    );
    assert.ok(y.includes('uid: hanork-prometheus'));
});

test('dashboard Grafana provisionado', () => {
    assert.ok(fs.existsSync(path.join(root, 'observability/grafana/dashboards/hanork-operations.json')));
});

test('npm run obs:up definido', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts['obs:up']);
});

test('.env.example documenta SP-8', () => {
    const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
    assert.ok(env.includes('OBSERVABILIDADE (SP-8)'));
    assert.ok(env.includes('HANORK_GRAFANA_PASS') || env.includes('GRAFANA_PORT'));
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — observability config\n');
process.exit(failed ? 1 : 0);
