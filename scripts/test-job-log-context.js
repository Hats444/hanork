#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { jobLogFields } = require('../src/modules/queue/jobLogContext');

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

console.log('\n=== jobLogContext ===\n');

test('extrai orderId e jobId', () => {
    const fields = jobLogFields({
        id: '42',
        data: { orderId: 'ord-1', userId: 9, telegramId: '123' },
        queue: { name: 'delivery:products' },
    });
    assert.strictEqual(fields.jobId, '42');
    assert.strictEqual(fields.orderId, 'ord-1');
    assert.strictEqual(fields.queue, 'delivery:products');
    assert.strictEqual(fields.userId, 9);
    assert.strictEqual(fields.telegramId, '123');
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — jobLogContext\n');
process.exit(failed ? 1 : 0);
