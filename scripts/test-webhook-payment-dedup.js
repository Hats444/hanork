#!/usr/bin/env node
'use strict';

const assert = require('assert');
const dedup = require('../src/modules/payment/webhookPaymentDedup');

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

console.log('\n=== Webhook payment dedup ===\n');

test('markProcessed e has', () => {
    dedup._processedPaymentIds.clear();
    assert.strictEqual(dedup.has('p1'), false);
    dedup.markProcessed('p1', 1000);
    assert.strictEqual(dedup.has('p1'), true);
});

test('cleanup remove antigos', () => {
    dedup._processedPaymentIds.clear();
    dedup.markProcessed('old', Date.now() - dedup.RETENTION_MS - 1000);
    dedup.markProcessed('new', Date.now());
    const logs = [];
    dedup.runWebhookDedupCleanup({
        debug: (msg) => logs.push(msg),
        info: () => {},
    });
    assert.strictEqual(dedup.has('old'), false);
    assert.strictEqual(dedup.has('new'), true);
});

test('hasDb e markDb com prisma mock', () => {
    const store = new Set();
    const prisma = {
        processedWebhook: {
            isProcessed(id) { return store.has(String(id)); },
            markProcessed(id, orderId) { store.add(String(id)); },
        },
    };
    process.env.MP_WEBHOOK_DB_DEDUP = '1';
    assert.strictEqual(dedup.hasDb(prisma, 'mp-99'), false);
    dedup.markDb(prisma, 'mp-99', 'ord-1');
    assert.strictEqual(dedup.hasDb(prisma, 'mp-99'), true);
    process.env.MP_WEBHOOK_DB_DEDUP = '0';
    assert.strictEqual(dedup.hasDb(prisma, 'mp-99'), false);
    delete process.env.MP_WEBHOOK_DB_DEDUP;
});

test('isDbDedupEnabled padrão ativo', () => {
    delete process.env.MP_WEBHOOK_DB_DEDUP;
    assert.strictEqual(dedup.isDbDedupEnabled(), true);
    process.env.MP_WEBHOOK_DB_DEDUP = '0';
    assert.strictEqual(dedup.isDbDedupEnabled(), false);
    delete process.env.MP_WEBHOOK_DB_DEDUP;
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — webhook payment dedup\n');
process.exit(failed ? 1 : 0);
