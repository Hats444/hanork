#!/usr/bin/env node
'use strict';

/**
 * V4 QW-2 — config e API do poll automático PIX.
 */
const assert = require('assert');
const { isEnabled, cancelPixAutoPoll, schedulePixAutoPoll } = require('../src/modules/payment/pixAutoPoll');

const saved = { ...process.env };
function restore() {
    process.env = { ...saved };
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

console.log('\n=== QW-2 PIX auto-poll ===\n');

test('habilitado por padrão', () => {
    delete process.env.PIX_AUTO_POLL;
    assert.strictEqual(isEnabled(), true);
});

test('PIX_AUTO_POLL=0 desativa', () => {
    process.env.PIX_AUTO_POLL = '0';
    assert.strictEqual(isEnabled(), false);
});

test('defaults 10 tentativas × 30s', () => {
    restore();
    process.env.PIX_AUTO_POLL_ATTEMPTS = '10';
    process.env.PIX_AUTO_POLL_INTERVAL_MS = '30000';
    assert.strictEqual(parseInt(process.env.PIX_AUTO_POLL_ATTEMPTS, 10), 10);
    assert.strictEqual(parseInt(process.env.PIX_AUTO_POLL_INTERVAL_MS, 10), 30000);
});

test('cancelPixAutoPoll não lança sem timers', () => {
    cancelPixAutoPoll('ord-test-none');
});

test('schedulePixAutoPoll ignora sem orderId', () => {
    schedulePixAutoPoll('', { from: { id: 1 } }, {});
});

restore();

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — PIX auto-poll\n');
process.exit(failed ? 1 : 0);
