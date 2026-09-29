#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { formatMpAmount, formatMpError, isMpTestMode } = require('../src/modules/payment/PaymentService');

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

console.log('\n=== Payment utils ===\n');

test('formatMpAmount arredonda', () => {
    assert.strictEqual(formatMpAmount(10.999), 11);
    assert.strictEqual(formatMpAmount(1.5), 1.5);
});

test('formatMpAmount rejeita abaixo do mínimo', () => {
    assert.throws(() => formatMpAmount(0.1), /mínimo/i);
});

test('isMpTestMode com TEST token', () => {
    assert.strictEqual(isMpTestMode('TEST-abc-1234567890'), true);
    assert.strictEqual(isMpTestMode('APP_USR-abc-1234567890'), false);
});

test('formatMpError inclui status', () => {
    const msg = formatMpError({
        response: { status: 400, data: { message: 'bad_request' } },
    });
    assert.ok(msg.includes('400'));
    assert.ok(msg.includes('bad_request'));
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — payment utils\n');
process.exit(failed ? 1 : 0);
