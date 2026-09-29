#!/usr/bin/env node
'use strict';

/**
 * Smoke test Hanork Div v5a + v5a.1 (hub, handlers, antiBan manual blast).
 * Uso: node scripts/verify-wadv-v5a.js
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

const REQUIRED_CALLBACKS = [
    'wadv:home',
    'wadv:monitor',
    'wadv:monitor:busy',
    'wadv:monitor:live:*',
    'wadv:session',
    'wadv:status',
    'wadv:auto',
    'wadv:utils',
    'wadv:groups',
    'wadv:groups:list',
    'wadv:campaigns',
    'wadv:camp:go',
];

try {
    const userHandlers = require(path.join(ROOT, 'src/core/UserHandlers.js'));
    const map = userHandlers.UserHandlers || userHandlers;
    for (const cb of REQUIRED_CALLBACKS) {
        if (typeof map[cb] === 'function') ok(`callback ${cb}`);
        else fail(`callback ${cb}`, 'não registrado em UserHandlers');
    }
} catch (e) {
    fail('UserHandlers', e.message);
}

const kbPath = 'src/modules/wa-divulgacao/keyboards/waDivulgacaoKeyboards.js';
if (exists(kbPath)) {
    const kb = read(kbPath);
    for (const token of [
        'monitoringHubKeyboard',
        'liveProgressKeyboard',
        'campaignLaunchKeyboard',
        'sessionHubKeyboard',
        'groupsHubKeyboard',
        "callback_data: 'wadv:monitor'",
        "callback_data: 'wadv:monitor:busy'",
        'wadv:monitor:live:',
        "callback_data: 'wadv:session'",
        'campaignBreadcrumb',
    ]) {
        if (kb.includes(token)) ok(`keyboard ${token}`);
        else fail(`keyboard ${token}`);
    }
    const uiPath = 'src/modules/wa-divulgacao/handlers/waDivulgacaoUiHandlers.js';
    if (exists(uiPath) && read(uiPath).includes('Não dispare de novo')) {
        ok('monitor hub anti-double-click copy');
    } else {
        fail('monitor hub anti-double-click copy');
    }
} else {
    fail(kbPath, 'arquivo ausente');
}

const handlersPath = 'src/modules/wa-divulgacao/callbacks/waDivulgacaoHandlers.js';
if (exists(handlersPath)) {
    const h = read(handlersPath);
    for (const token of [
        "'wadv:monitor'",
        "'wadv:monitor:busy'",
        "'wadv:monitor:live:*'",
        "'wadv:session'",
        "'wadv:status'",
        'sendStatusWizard',
        'buildLiveProgressPanel',
        "'wadv:groups:list'",
    ]) {
        if (h.includes(token)) ok(`handler ${token}`);
        else fail(`handler ${token}`);
    }
} else {
    fail(handlersPath);
}

const antiBanPath = 'zero-divu/src/services/antiBan.js';
if (exists(antiBanPath)) {
    const ab = read(antiBanPath);
    if (/manualBlast/.test(ab) && /bypassRiskPause/.test(ab)) {
        ok('antiBan manualBlast bypass');
    } else {
        fail('antiBan manualBlast bypass', 'linha esperada ausente');
    }
} else {
    fail(antiBanPath);
}

for (const rel of ['zero-divu/src/services/divBlast.js', 'zero-divu/src/services/customBlast.js']) {
    if (exists(rel) && read(rel).includes('forceReset')) ok(`${path.basename(rel)} forceReset`);
    else fail(`${rel} forceReset`);
}

if (exists('zero-divu/src/services/blastCoordinator.js')) {
    const bc = read('zero-divu/src/services/blastCoordinator.js');
    if (bc.includes('forceReset')) ok('blastCoordinator recover + forceReset');
    else fail('blastCoordinator forceReset');
    if (bc.includes('groupsFilePath') && bc.includes('sessionCoordDir')) {
        ok('blastCoordinator groups.json per session');
    } else {
        fail('blastCoordinator session-scoped groups.json');
    }
}

if (exists('zero-divu/src/services/customBlast.js')) {
    const cb = read('zero-divu/src/services/customBlast.js');
    if (cb.includes('resolveBlastGroupIds')) ok('customBlast resolveBlastGroupIds');
    else fail('customBlast resolveBlastGroupIds');
}

if (exists('zero-divu/src/services/statusMessage.js')) {
    const sm = read('zero-divu/src/services/statusMessage.js');
    if (sm.includes('Blast resumo:')) ok('statusMessage blast summary log');
    else fail('statusMessage blast summary log');
    if (sm.includes('manualBypass')) ok('statusMessage manualBlast anti-ban bypass');
    else fail('statusMessage manualBlast bypass');
}

if (exists('zero-divu/src/ipc/operations.js')) {
    const op = read('zero-divu/src/ipc/operations.js');
    if (op.includes('force_required') || op.includes('force: true')) ok('operations force invariant');
    else fail('operations force invariant');
}

if (exists('src/modules/wa-divulgacao/waDivulgacaoCopy.js')) {
    const cp = read('src/modules/wa-divulgacao/waDivulgacaoCopy.js');
    if (cp.includes('campaignDoneDetailedMessage')) ok('Copy campaignDoneDetailedMessage');
    else fail('Copy campaignDoneDetailedMessage');
    if (cp.includes('workerSyncingMessage') && /syncing/.test(cp)) ok('Copy timeout → syncing');
    else fail('Copy timeout → syncing');
    if (cp.includes('isSubscriberIpcSyncingError') && /🟡.*Sincronizando/.test(cp)) {
        ok('Copy workerSyncingMessage 🟡');
    } else {
        fail('Copy workerSyncingMessage 🟡');
    }
    if (
        cp.includes('isSubscriberIpcTimeout') &&
        cp.includes('isSubscriberIpcNotConnected') &&
        /isSubscriberIpcTimeout\(ack\)/.test(cp)
    ) {
        ok('Copy timeout vs not_connected');
    } else {
        fail('Copy timeout vs not_connected');
    }
}

if (exists('src/modules/wa-divulgacao/waDivulgacaoAlwaysOnService.js')) {
    const ao = read('src/modules/wa-divulgacao/waDivulgacaoAlwaysOnService.js');
    if (ao.includes('PREWARM_CONCURRENCY') || ao.includes('Promise.all')) {
        ok('always-on parallel prewarm');
    } else {
        fail('always-on parallel prewarm');
    }
    if (/TICK_MS.*30000|ALWAYS_ON_INTERVAL_MS.*30000/.test(ao)) ok('always-on tick 30s');
    else fail('always-on tick 30s');
    if (ao.includes('reconnectBackoffMs') && /RECONNECT_TICK_MS.*120000/.test(ao)) {
        ok('always-on reconnect backoff 120s');
    } else {
        fail('always-on reconnect backoff 120s');
    }
    if (ao.includes('wadv_reconnect_ok') && ao.includes('RECONNECT_JITTER_MS')) {
        ok('always-on wadv_reconnect_ok + jitter');
    } else {
        fail('always-on wadv_reconnect_ok + jitter');
    }
    if (/PREWARM_CONCURRENCY.*\|\| 5/.test(ao)) ok('always-on prewarm cap 5');
    else fail('always-on prewarm cap 5');
    if (ao.includes('checkOfflineAlerts')) ok('always-on offline alert Fase 3');
    else fail('always-on offline alert Fase 3');
    if (ao.includes('WA_DIVULGACAO_MAX_ACTIVE_WORKERS')) ok('always-on RAM cap Fase 3');
    else fail('always-on RAM cap Fase 3');
}

if (exists('src/modules/wa-divulgacao/waDivulgacaoOpsMetrics.js')) {
    const om = read('src/modules/wa-divulgacao/waDivulgacaoOpsMetrics.js');
    if (om.includes('getOpsMetricsSnapshot') && om.includes('wadv_workers_active')) {
        ok('waDivulgacaoOpsMetrics Fase 3');
    } else {
        fail('waDivulgacaoOpsMetrics Fase 3');
    }
}

if (exists('scripts/verify-wadv-always-on.js')) ok('verify-wadv-always-on.js Fase 3');
else fail('verify-wadv-always-on.js Fase 3');

if (exists('src/modules/wa-divulgacao/waDivulgacaoLoginService.js')) {
    const ls = read('src/modules/wa-divulgacao/waDivulgacaoLoginService.js');
    if (ls.includes('PANEL_CONN_CACHE_TTL_MS') && ls.includes('invalidatePanelConnectionCache')) {
        ok('loginService panel cache TTL 10s');
    } else {
        fail('loginService panel cache TTL 10s');
    }
    if (ls.includes('forceRefresh')) ok('loginService forceRefresh bypass cache');
    else fail('loginService forceRefresh bypass cache');
    if (
        ls.includes('hasSavedWaSession') &&
        ls.includes("reason: syncing ? 'syncing'") &&
        ls.includes('workerSyncingMessage')
    ) {
        ok('loginService _guardWorker syncing with creds');
    } else {
        fail('loginService _guardWorker syncing with creds');
    }
}

if (exists('src/modules/wa-divulgacao/waDivulgacaoWorkerService.js')) {
    const ws = read('src/modules/wa-divulgacao/waDivulgacaoWorkerService.js');
    if (ws.includes('_ensureWorkerReady') && ws.includes('syncPanelBackground')) {
        ok('worker _ensureWorkerReady + syncPanelBackground');
    } else {
        fail('worker _ensureWorkerReady + syncPanelBackground');
    }
    if (ws.includes('forceRefresh: true')) ok('syncPanelBackground forceRefresh');
    else fail('syncPanelBackground forceRefresh');
}

if (exists('src/plugins/zero-divu/waWorkerEnsureService.js')) {
    ok('waWorkerEnsureService central helper');
} else {
    fail('waWorkerEnsureService central helper');
}

if (exists('src/plugins/zero-divu/waIpcHelper.js')) {
    const ipc = read('src/plugins/zero-divu/waIpcHelper.js');
    if (!/worker offline/i.test(ipc)) ok('admin IPC no worker offline copy');
    else fail('admin IPC worker offline copy');
}

if (exists('src/plugins/zero-divu/spawnZeroWorker.js')) {
    const sp = read('src/plugins/zero-divu/spawnZeroWorker.js');
    if (sp.includes('ensureBothAdminWorkers')) ok('ensureBothAdminWorkers export');
    else fail('ensureBothAdminWorkers export');
}

if (exists('src/modules/wa-divulgacao/waDivulgacaoClient.js')) {
    const cl = read('src/modules/wa-divulgacao/waDivulgacaoClient.js');
    if (cl.includes('sanitizeSubscriberIpcAck') && cl.includes('hasSavedWaSession')) {
        ok('client sanitizeSubscriberIpcAck + hasSession');
    } else {
        fail('client sanitizeSubscriberIpcAck + hasSession');
    }
}

const campPath = 'src/modules/wa-divulgacao/waDivulgacaoCampaignService.js';
if (exists(campPath)) {
    const camp = read(campPath);
    if (camp.includes('Não toque em Disparar de novo')) ok('campanha aviso multi-disparo');
    else fail('campanha aviso multi-disparo');
    if (camp.includes('_campaignBreadcrumb') && camp.includes("Painel › Campanhas ›")) {
        ok('campanha breadcrumb wizard');
    } else {
        fail('campanha breadcrumb wizard');
    }
    if (camp.includes('buildLiveProgressPanel') && camp.includes('getActiveBlastInfo')) {
        ok('campanha live progress panel');
    } else {
        fail('campanha live progress panel');
    }
    if (
        camp.includes('hasSession ? Copy.workerSyncingMessage()') &&
        camp.includes("reason: hasSession ? 'syncing'")
    ) {
        ok('campaign _guardWorker syncing with creds');
    } else {
        fail('campaign _guardWorker syncing with creds');
    }
} else {
    fail(campPath);
}

console.log('');
if (failed === 0) {
    console.log('verify-wadv-v5a: ALL OK');
    process.exit(0);
}
console.log(`verify-wadv-v5a: ${failed} falha(s)`);
process.exit(1);
