#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const assert = require('assert');
const { isMpIp, validateMpSignature } = require('../src/modules/payment/mpWebhookSecurity');

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

const saved = {
    NODE_ENV: process.env.NODE_ENV,
    MP_WEBHOOK_SECRET: process.env.MP_WEBHOOK_SECRET,
    MP_ALLOW_UNSIGNED_WEBHOOK: process.env.MP_ALLOW_UNSIGNED_WEBHOOK,
    MP_SKIP_IP_CHECK: process.env.MP_SKIP_IP_CHECK,
};

function restoreEnv() {
    for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
}

function makeSignedReq(secret, dataId = 'pay-99') {
    const xReqId = 'req-test-1';
    const ts = '1700000000';
    const manifest = `id:${dataId};request-id:${xReqId};ts:${ts};`;
    const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    return {
        headers: {
            'x-signature': `ts=${ts},v1=${v1}`,
            'x-request-id': xReqId,
        },
        body: { data: { id: dataId }, live_mode: true },
        socket: { remoteAddress: '200.80.1.2' },
    };
}

console.log('\n=== MP webhook security ===\n');

test('HMAC válido aceita', () => {
    process.env.MP_WEBHOOK_SECRET = 'unit-test-secret';
    process.env.NODE_ENV = 'production';
    assert.strictEqual(validateMpSignature(makeSignedReq('unit-test-secret')), true);
});

test('HMAC inválido rejeita', () => {
    process.env.MP_WEBHOOK_SECRET = 'unit-test-secret';
    process.env.NODE_ENV = 'production';
    const req = makeSignedReq('unit-test-secret');
    req.headers['x-signature'] = req.headers['x-signature'].replace(/v1=[a-f0-9]+/, 'v1=deadbeef');
    assert.strictEqual(validateMpSignature(req), false);
});

test('HMAC timing-safe — assinatura quase igual rejeita', () => {
    process.env.MP_WEBHOOK_SECRET = 'unit-test-secret';
    process.env.NODE_ENV = 'production';
    const req = makeSignedReq('unit-test-secret');
    const good = req.headers['x-signature'].match(/v1=([a-f0-9]+)/)[1];
    const almost = good.slice(0, -1) + (good.slice(-1) === 'a' ? 'b' : 'a');
    req.headers['x-signature'] = req.headers['x-signature'].replace(/v1=[a-f0-9]+/, `v1=${almost}`);
    assert.strictEqual(validateMpSignature(req), false);
});

test('produção sem secret rejeita', () => {
    delete process.env.MP_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.MP_ALLOW_UNSIGNED_WEBHOOK;
    const req = makeSignedReq('ignored');
    assert.strictEqual(validateMpSignature(req), false);
});

test('dev sem secret permite', () => {
    delete process.env.MP_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'development';
    assert.strictEqual(validateMpSignature({ headers: {}, body: {} }), true);
});

test('IP MP em produção', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MP_SKIP_IP_CHECK;
    assert.strictEqual(isMpIp({ headers: {}, socket: { remoteAddress: '200.80.10.5' } }), true);
});

test('IP desconhecido em produção', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MP_SKIP_IP_CHECK;
    assert.strictEqual(isMpIp({ headers: {}, socket: { remoteAddress: '8.8.8.8' } }), false);
});

restoreEnv();

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — mp webhook security\n');
process.exit(failed ? 1 : 0);
