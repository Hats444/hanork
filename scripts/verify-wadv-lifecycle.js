#!/usr/bin/env node
'use strict';

/**
 * Smoke §18.24.6 — lifecycle plano Hanork Div (expire, lembretes, cancel Bull, handlers).
 * Uso: node scripts/verify-wadv-lifecycle.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
let failed = 0;

function ok(label) {
    console.log(`[OK] ${label}`);
}

function fail(label, detail = '') {
    failed += 1;
    console.log(`[FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
}

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
    return fs.existsSync(path.join(ROOT, rel));
}

try {
    const alwaysOn = require(path.join(ROOT, 'src/modules/wa-divulgacao/waDivulgacaoAlwaysOnService.js'));
    if (typeof alwaysOn.expireDueSubscriptions === 'function') {
        ok('expireDueSubscriptions exportado (always-on)');
    } else {
        fail('expireDueSubscriptions exportado (always-on)');
    }
} catch (e) {
    fail('waDivulgacaoAlwaysOnService', e.message);
}

try {
    const subSvc = require(path.join(ROOT, 'src/modules/wa-divulgacao/waDivulgacaoSubscriptionService.js'));
    if (typeof subSvc.expireDueSubscriptions === 'function') {
        ok('WaDivulgacaoSubscriptionService.expireDueSubscriptions');
    } else {
        fail('WaDivulgacaoSubscriptionService.expireDueSubscriptions');
    }
    if (typeof subSvc.listDueRenewalReminders === 'function') {
        ok('WaDivulgacaoSubscriptionService.listDueRenewalReminders');
    } else {
        fail('WaDivulgacaoSubscriptionService.listDueRenewalReminders');
    }
} catch (e) {
    fail('waDivulgacaoSubscriptionService', e.message);
}

try {
    const sched = require(path.join(ROOT, 'src/modules/wa-divulgacao/waDivulgacaoScheduleService.js'));
    if (typeof sched.cancelAllPendingCampaigns === 'function') {
        ok('cancelAllPendingCampaigns (schedule service)');
    } else {
        fail('cancelAllPendingCampaigns (schedule service)');
    }
} catch (e) {
    fail('waDivulgacaoScheduleService', e.message);
}

const handlersPath = 'src/modules/wa-divulgacao/callbacks/waDivulgacaoHandlers.js';
if (exists(handlersPath)) {
    const h = read(handlersPath);
    if (/async function requireActiveSub/.test(h) && h.includes('planExpiredMessage')) {
        ok('requireActiveSub + planExpiredMessage nos handlers');
    } else {
        fail('requireActiveSub + planExpiredMessage nos handlers');
    }
} else {
    fail(handlersPath, 'arquivo ausente');
}

const monitorPath = 'src/modules/virtuo/jobs/activationMonitorJob.js';
if (exists(monitorPath)) {
    const m = read(monitorPath);
    if (m.includes('phone_assigned_at')) {
        ok('activationMonitorJob timeout usa phone_assigned_at');
    } else {
        fail('activationMonitorJob timeout usa phone_assigned_at');
    }
} else {
    fail(monitorPath);
}

const alwaysOnPath = 'src/modules/wa-divulgacao/waDivulgacaoAlwaysOnService.js';
if (exists(alwaysOnPath)) {
    const ao = read(alwaysOnPath);
    if (ao.includes('WA_DIVULGACAO_LOGOUT_ON_EXPIRE')) {
        ok('WA_DIVULGACAO_LOGOUT_ON_EXPIRE referenciado no always-on');
    } else {
        fail('WA_DIVULGACAO_LOGOUT_ON_EXPIRE referenciado no always-on');
    }
}

const cfgPath = 'src/modules/wa-divulgacao/waDivulgacaoConfig.js';
if (exists(cfgPath)) {
    const cfg = read(cfgPath);
    if (cfg.includes('WA_DIVULGACAO_LOGOUT_ON_EXPIRE') || cfg.includes('logoutOnExpire')) {
        ok('WA_DIVULGACAO_LOGOUT_ON_EXPIRE documentado em waDivulgacaoConfig');
    } else {
        fail('WA_DIVULGACAO_LOGOUT_ON_EXPIRE documentado em waDivulgacaoConfig');
    }
} else {
    fail(cfgPath);
}

if (exists('scripts/verify-wadv-lifecycle.js')) {
    ok('verify-wadv-lifecycle.js presente');
}

console.log('');
if (failed === 0) {
    console.log('verify-wadv-lifecycle: ALL OK');
    process.exit(0);
}
console.log(`verify-wadv-lifecycle: ${failed} falha(s)`);
process.exit(1);
