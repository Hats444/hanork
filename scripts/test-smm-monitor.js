#!/usr/bin/env node
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

process.env.SMM_ENABLED = '1';

let ok = 0;
let fail = 0;

function assert(cond, msg) {
    if (cond) { ok++; console.log('  OK', msg); }
    else { fail++; console.log('  FAIL', msg); }
}

const { connect } = require('../src/config/database-sqlite');
const SmmConfig = require('../src/modules/smm/smmConfig');
const SmmStatusService = require('../src/modules/smm/services/statusService');
const { mapProviderStatus, ORDER_STATUS } = require('../src/modules/smm/constants/orderStatuses');
const { runOrderMonitorJob } = require('../src/modules/smm/jobs/orderMonitorJob');
const {
    runSmmOrderMonitorCycle,
    DEFAULT_INTERVAL_MS: MONITOR_MS,
} = require('../src/jobs/schedulers/smmOrderMonitorScheduler');
const {
    DEFAULT_INTERVAL_MS: SYNC_MS,
} = require('../src/jobs/schedulers/smmCatalogSyncScheduler');
const { startSmmSchedulers } = require('../src/modules/smm/hooks/registerSmmSchedulers');

(async () => {
    console.log('\n=== SMM Monitor + Sync (Onda D) ===\n');

    connect();

    assert(SmmConfig.orderMonitorIntervalMs === 10 * 60 * 1000, 'default monitor 10min');
    assert(SmmConfig.syncIntervalMs === 6 * 60 * 60 * 1000, 'default sync 6h');
    assert(MONITOR_MS === 10 * 60 * 1000, 'scheduler monitor constant');
    assert(SYNC_MS === 6 * 60 * 60 * 1000, 'scheduler sync constant');

    assert(mapProviderStatus({ status: 'Completed' }) === ORDER_STATUS.COMPLETED, 'map Completed');
    assert(mapProviderStatus({ status: 'Partial' }) === ORDER_STATUS.PARTIAL, 'map Partial');
    assert(mapProviderStatus({ status: 'Pending' }) === ORDER_STATUS.PROCESSING, 'map Pending');

    const msg = SmmStatusService.buildTerminalMessage(
        { id: 1, hanork_order_id: 'eeeeeeee-12345678', quantity: 1000, sale_price: 12.5 },
        ORDER_STATUS.COMPLETED
    );
    assert(msg.includes('concluído'), 'terminal message completed');
    assert(msg.includes('#12345678'), 'terminal message order ref');

    assert(SmmStatusService.TERMINAL_STATUSES.has(ORDER_STATUS.COMPLETED), 'terminal set');

    const monitor = await runOrderMonitorJob(null);
    assert(typeof monitor.checked === 'number', 'runOrderMonitorJob returns checked');

    const cycle = await runSmmOrderMonitorCycle({ log: { info: () => {}, error: () => {}, warn: () => {} } });
    assert(cycle.checked >= 0, 'monitor cycle ok');

    const handles = startSmmSchedulers({
        log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    assert(handles.length === 3, 'three scheduler handles');

    console.log(`\n${ok} ok, ${fail} fail\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
