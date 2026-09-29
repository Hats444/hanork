#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    isDurableAckEnabled,
    isSyncAckEnabled,
    validateMpWebhookRequest,
    RECEIPT_PREFIX,
} = require('../src/modules/payment/mpWebhookHandler');

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

const saved = { ...process.env };

console.log('\n=== MP webhook handler (P5-1) ===\n');

test('durable ack ativo por padrão', () => {
    delete process.env.MP_WEBHOOK_DURABLE_ACK;
    assert.strictEqual(isDurableAckEnabled(), true);
    process.env.MP_WEBHOOK_DURABLE_ACK = '0';
    assert.strictEqual(isDurableAckEnabled(), false);
});

test('sync ack desligado por padrão', () => {
    delete process.env.MP_WEBHOOK_SYNC_ACK;
    assert.strictEqual(isSyncAckEnabled(), false);
    process.env.MP_WEBHOOK_SYNC_ACK = '1';
    assert.strictEqual(isSyncAckEnabled(), true);
});

test('validação rejeita IP inválido em produção', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MP_SKIP_IP_CHECK;
    const r = validateMpWebhookRequest({
        headers: {},
        socket: { remoteAddress: '8.8.8.8' },
        body: {},
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 403);
});

test('prefixo receipt kv', () => {
    assert.ok(RECEIPT_PREFIX.startsWith('mp_wh_pending:'));
});

process.env = saved;

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — MP webhook handler\n');
process.exit(failed ? 1 : 0);
