#!/usr/bin/env node
'use strict';

/**
 * Health check Hanork Div always-on — assinantes × PID × connected.
 * Uso: node scripts/verify-wadv-always-on.js
 * §18.25 Fase 3.1
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
require('dotenv').config({ path: path.join(ROOT, '.env') });

let failed = 0;

function ok(label) {
    console.log(`[OK] ${label}`);
}

function fail(label, detail = '') {
    failed += 1;
    console.log(`[FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
}

function warn(label, detail = '') {
    console.log(`[WARN] ${label}${detail ? ` — ${detail}` : ''}`);
}

try {
    const { isEnabled } = require('../src/modules/wa-divulgacao/waDivulgacaoAlwaysOnService');
    if (isEnabled()) ok('always-on enabled');
    else warn('always-on disabled (WA_DIVULGACAO_ALWAYS_ON=0)');
} catch (e) {
    fail('always-on module', e.message);
}

let snapshot;
try {
    const { getOpsMetricsSnapshot } = require('../src/modules/wa-divulgacao/waDivulgacaoOpsMetrics');
    snapshot = getOpsMetricsSnapshot();
    ok('ops metrics snapshot');
} catch (e) {
    fail('ops metrics snapshot', e.message);
    snapshot = { counters: {}, subscribers: [] };
}

const c = snapshot.counters || {};
console.log('');
console.log('--- wadv metrics ---');
console.log(`  subscribers_active: ${c.wadv_subscribers_active ?? 0}`);
console.log(`  workers_active:     ${c.wadv_workers_active ?? 0}`);
console.log(`  workers_connected:  ${c.wadv_workers_connected ?? 0}`);
console.log(`  worker_restarts:    ${c.wadv_worker_restarts ?? 0}`);
console.log(`  ipc_timeouts:       ${c.wadv_ipc_timeouts ?? 0}`);
console.log(`  reconnect_ok:       ${c.wadv_reconnect_ok ?? 0}`);
console.log(`  offline_alerts:     ${c.wadv_offline_alerts ?? 0}`);
console.log(`  max_active_workers: ${snapshot.maxActiveWorkers ?? 20}`);
console.log('');

const subs = snapshot.subscribers || [];
if (!subs.length) {
    warn('nenhum assinante ativo no DB');
} else {
    for (const s of subs) {
        const line = `tg=${s.telegramId} pid=${s.workerPid || '-'} alive=${s.pidAlive} wa=${s.connected ? 'on' : 'off'} phone=${s.phone || '-'}`;
        if (s.pidAlive) {
            ok(line);
        } else if (s.hasSession) {
            warn(line, 'creds ok mas worker ausente');
        } else {
            ok(`${line} (sem sessão WA — ok se nunca conectou)`);
        }
    }
}

const fs = require('fs');
const alwaysOnPath = path.join(ROOT, 'src/modules/wa-divulgacao/waDivulgacaoAlwaysOnService.js');
const metricsPath = path.join(ROOT, 'src/modules/wa-divulgacao/waDivulgacaoOpsMetrics.js');
const scriptSelf = path.join(ROOT, 'scripts/verify-wadv-always-on.js');

for (const [label, p] of [
    ['waDivulgacaoOpsMetrics.js', metricsPath],
    ['verify-wadv-always-on.js', scriptSelf],
]) {
    if (fs.existsSync(p)) ok(`file ${label}`);
    else fail(`file ${label}`, 'ausente');
}

if (fs.existsSync(alwaysOnPath)) {
    const src = fs.readFileSync(alwaysOnPath, 'utf8');
    if (src.includes('checkOfflineAlerts')) ok('always-on offline alert hook');
    else fail('always-on offline alert hook');
    if (src.includes('WA_DIVULGACAO_MAX_ACTIVE_WORKERS')) ok('always-on RAM cap env');
    else fail('always-on RAM cap env');
}

const opsPath = path.join(ROOT, 'src/modules/dashboard/OpsDashboardService.js');
if (fs.existsSync(opsPath)) {
    const ops = fs.readFileSync(opsPath, 'utf8');
    if (ops.includes('wadv') || ops.includes('waDivulgacao')) ok('ops summary wadv block');
    else fail('ops summary wadv block');
}

console.log('');
if (failed === 0) {
    console.log('verify-wadv-always-on: ALL OK');
    process.exit(0);
}
console.log(`verify-wadv-always-on: ${failed} falha(s)`);
process.exit(1);
