'use strict';

const assert = require('assert');
const {
    classifyBalance,
    shouldNotifyMonitor,
    buildBalanceStatusHtml,
    _resetMonitorState,
    LEVEL,
} = require('../src/modules/smm/services/providerBalanceService');
const SmmConfig = require('../src/modules/smm/smmConfig');

_resetMonitorState();

const warn = SmmConfig.balanceWarnThreshold;
const crit = SmmConfig.balanceCriticalThreshold;

assert.strictEqual(classifyBalance(warn + 10).level, LEVEL.OK);
assert.strictEqual(classifyBalance(warn - 1).level, LEVEL.WARNING);
assert.strictEqual(classifyBalance(crit - 1).level, LEVEL.CRITICAL);

let d = shouldNotifyMonitor(LEVEL.WARNING, warn - 5);
assert.strictEqual(d.notify, true);

d = shouldNotifyMonitor(LEVEL.WARNING, warn - 5);
assert.strictEqual(d.notify, false, 'dedup same level');

d = shouldNotifyMonitor(LEVEL.CRITICAL, crit - 1);
assert.strictEqual(d.notify, true, 'escalation to critical');

const html = buildBalanceStatusHtml(
    { balance: 12, currency: 'BRL', level: LEVEL.CRITICAL },
    { orderRef: '#abc12345' }
);
assert(html.includes('Recarregar') || html.includes('recarregar'), 'recharge hint');
assert(html.includes('abc12345'), 'order ref');

console.log('test-smm-balance-monitor.js OK');
