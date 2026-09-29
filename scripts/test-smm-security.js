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
const {
    canRequestRefill,
    canRequestCancel,
    serviceFlag,
    checkoutErrorMessage,
} = require('../src/modules/smm/validators/smmActionValidator');
const { ORDER_STATUS } = require('../src/modules/smm/constants/orderStatuses');
const { checkSmmRate } = require('../src/modules/smm/middlewares/smmRateLimiter');
const { findRecentDuplicate } = require('../src/modules/smm/helpers/smmDuplicateGuard');
const SmmOrderEventsRepository = require('../src/modules/smm/repositories/smmOrderEventsRepository');
const { runRefillMonitorJob } = require('../src/modules/smm/jobs/refillMonitorJob');
const { CB } = require('../src/modules/smm/utils/smmCallbackData');

(async () => {
    console.log('\n=== SMM Security (Onda E) ===\n');

    connect();

    assert(serviceFlag(1) === true, 'serviceFlag int');
    assert(serviceFlag(0) === false, 'serviceFlag off');

    const svcRefill = { refill: 1, cancel: 0 };
    const svcCancel = { refill: 0, cancel: 1 };
    const completed = { id: 1, status: ORDER_STATUS.COMPLETED, provider_order_id: '99' };
    const processing = { id: 2, status: ORDER_STATUS.PROCESSING, provider_order_id: '88' };

    assert(canRequestRefill(completed, svcRefill).ok, 'refill allowed when completed');
    assert(!canRequestRefill(processing, svcRefill).ok, 'refill blocked when processing');
    assert(!canRequestRefill(completed, svcCancel).ok, 'refill blocked without flag');

    assert(canRequestCancel(processing, svcCancel).ok, 'cancel allowed when processing');
    assert(!canRequestCancel(completed, svcCancel).ok, 'cancel blocked when completed');
    assert(!canRequestCancel(processing, svcRefill).ok, 'cancel blocked without flag');

    assert(checkoutErrorMessage('duplicate_order').includes('idêntico'), 'duplicate message');

    const rl1 = await checkSmmRate(null, 111, 'test_action', { max: 3, windowSec: 60 });
    const rl2 = await checkSmmRate(null, 111, 'test_action', { max: 3, windowSec: 60 });
    const rl3 = await checkSmmRate(null, 111, 'test_action', { max: 3, windowSec: 60 });
    const rl4 = await checkSmmRate(null, 111, 'test_action', { max: 3, windowSec: 60 });
    assert(rl1.allowed && rl2.allowed && rl3.allowed, 'rate limit allows under max');
    assert(rl4.allowed === false, 'rate limit blocks over max');

    assert(CB.refill(5) === 'smm:rf:5', 'refill callback');
    assert(CB.cancelConfirm(5) === 'smm:cx:5:y', 'cancel confirm callback');

    const eventId = SmmOrderEventsRepository.record(1, 'test_event', 'unit-test');
    assert(!!eventId, 'order event recorded');

    const refillRun = await runRefillMonitorJob(null);
    assert(typeof refillRun.checked === 'number', 'refill monitor runs');

    const dup = findRecentDuplicate('999001', 406, 'https://instagram.com/x', 100, 15);
    assert(dup === null || dup.id != null, 'duplicate guard query');

    console.log(`\n${ok} ok, ${fail} fail\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
