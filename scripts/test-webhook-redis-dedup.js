#!/usr/bin/env node
'use strict';

const assert = require('assert');
const redisDedup = require('../src/modules/payment/webhookRedisDedup');
const dedup = require('../src/modules/payment/webhookPaymentDedup');

function createMockRedis() {
    const keys = new Map();
    return {
        async exists(key) {
            return keys.has(key) ? 1 : 0;
        },
        async set(key, val, ex, ttl, nx) {
            if (nx === 'NX' && keys.has(key)) return null;
            keys.set(key, { val, expires: Date.now() + ttl * 1000 });
            return 'OK';
        },
        async setex(key, ttl, val) {
            keys.set(key, { val, expires: Date.now() + ttl * 1000 });
            return 'OK';
        },
        async del(key) {
            keys.delete(key);
            return 1;
        },
        _keys: keys,
    };
}

let failed = 0;
async function test(name, fn) {
    try {
        await fn();
        console.log('  OK', name);
    } catch (e) {
        failed++;
        console.error('  FAIL', name + ':', e.message);
    }
}

const saved = { ...process.env };

console.log('\n=== Webhook Redis dedup (P5-2) ===\n');

(async () => {
    const mock = createMockRedis();
    redisDedup._setTestRedis(mock);
    process.env.MP_WEBHOOK_REDIS_DEDUP = '1';

    await test('hasRedis false antes do claim', async () => {
        assert.strictEqual(await redisDedup.hasRedis('pay-1'), false);
    });

    await test('tryClaimRedis — primeira instância ganha', async () => {
        mock._keys.clear();
        assert.strictEqual(await redisDedup.tryClaimRedis('pay-2'), true);
        assert.strictEqual(await redisDedup.tryClaimRedis('pay-2'), false);
    });

    await test('hasRedis true após claim', async () => {
        assert.strictEqual(await redisDedup.hasRedis('pay-2'), true);
    });

    await test('releaseRedisClaim libera retry', async () => {
        await redisDedup.releaseRedisClaim('pay-2');
        assert.strictEqual(await redisDedup.hasRedis('pay-2'), false);
        assert.strictEqual(await redisDedup.tryClaimRedis('pay-2'), true);
    });

    await test('markRedis popula chave sem NX', async () => {
        mock._keys.clear();
        await redisDedup.markRedis('pay-3');
        assert.strictEqual(await redisDedup.hasRedis('pay-3'), true);
    });

    await test('desligado com MP_WEBHOOK_REDIS_DEDUP=0', async () => {
        process.env.MP_WEBHOOK_REDIS_DEDUP = '0';
        assert.strictEqual(redisDedup.isRedisDedupEnabled(), false);
        assert.strictEqual(await redisDedup.tryClaimRedis('pay-x'), true);
        process.env.MP_WEBHOOK_REDIS_DEDUP = '1';
    });

    await test('dedup facade exporta redis helpers', async () => {
        assert.strictEqual(typeof dedup.hasRedis, 'function');
        assert.strictEqual(typeof dedup.tryClaimRedis, 'function');
        assert.strictEqual(typeof dedup.recordRedisDedup, 'function');
    });

    redisDedup._setTestRedis(null);
    process.env = saved;

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — webhook Redis dedup\n');
    process.exit(failed ? 1 : 0);
})();
