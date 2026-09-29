#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    isCancelled,
    isPaidOrDelivering,
    label,
    ORDER_FAILED,
} = require('../src/modules/order/orderStatus');

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

console.log('\n=== Order status ===\n');

test('FAILED e CANCELLED são cancelados', () => {
    assert.strictEqual(isCancelled('FAILED'), true);
    assert.strictEqual(isCancelled('CANCELLED'), true);
    assert.strictEqual(isCancelled('PAID'), false);
});

test('PAID e DELIVERING são pagos/em entrega', () => {
    assert.strictEqual(isPaidOrDelivering('PAID'), true);
    assert.strictEqual(isPaidOrDelivering('DELIVERING'), true);
    assert.strictEqual(isPaidOrDelivering('WAITING_PAYMENT'), false);
});

test('label conhecido e desconhecido', () => {
    assert.ok(label('PAID').includes('Pago'));
    assert.strictEqual(label('UNKNOWN_X'), 'UNKNOWN_X');
});

test('ORDER_FAILED exportado', () => {
    assert.strictEqual(ORDER_FAILED, 'FAILED');
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — order status\n');
process.exit(failed ? 1 : 0);
