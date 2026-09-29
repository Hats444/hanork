#!/usr/bin/env node
'use strict';

/**
 * 2.4 — RedisState fail-closed (namespaces críticos).
 */
require('../src/config/env');

const assert = require('assert');
const {
    RedisStateUnavailableError,
    isRedisStateFailClosedEnabled,
    CRITICAL_NAMESPACES,
    resetInstance,
} = require('../src/modules/state/RedisState');

let failed = 0;
function test(name, fn) {
    try {
        fn();
    } catch (e) {
        failed++;
        console.error('  FAIL', name + ':', e.message);
    }
}

async function testAsync(name, fn) {
    try {
        await fn();
        console.log('  OK', name);
    } catch (e) {
        failed++;
        console.error('  FAIL', name + ':', e.message);
    }
}

console.log('\n=== RedisState fail-closed (2.4) ===\n');

test('cart está em CRITICAL_NAMESPACES', () => {
    assert.ok(CRITICAL_NAMESPACES.has('cart'));
    assert.ok(CRITICAL_NAMESPACES.has('pending_purchase'));
});

test('gpt NÃO é namespace crítico', () => {
    assert.ok(!CRITICAL_NAMESPACES.has('gpt'));
});

(async () => {
    const prev = process.env.REDIS_STATE_FAIL_CLOSED_ENABLED;
    process.env.REDIS_STATE_FAIL_CLOSED_ENABLED = '1';
    resetInstance();
    const RedisState = require('../src/modules/state/RedisState');
    const rs = RedisState.getInstance();
    rs.useFallback = true;
    rs.redis = null;

    await testAsync('set cart com Redis offline lança RedisStateUnavailableError', async () => {
        let threw = false;
        try {
            await rs.set('cart', '123', [{ id: 1 }]);
        } catch (e) {
            threw = e instanceof RedisStateUnavailableError;
            assert.strictEqual(e.code, 'REDIS_STATE_UNAVAILABLE');
            assert.strictEqual(e.namespace, 'cart');
        }
        assert.strictEqual(threw, true);
    });

    await testAsync('set gpt com Redis offline usa fallback (não lança)', async () => {
        await rs.set('gpt', 'k1', { at: Date.now(), value: 'ok' }, 60);
        const v = await rs.get('gpt', 'k1');
        assert.deepStrictEqual(v.value, 'ok');
    });

    process.env.REDIS_STATE_FAIL_CLOSED_ENABLED = prev;
    resetInstance();

    test('flag parse', () => {
        process.env.REDIS_STATE_FAIL_CLOSED_ENABLED = '1';
        assert.strictEqual(isRedisStateFailClosedEnabled(), true);
        process.env.REDIS_STATE_FAIL_CLOSED_ENABLED = '0';
        assert.strictEqual(isRedisStateFailClosedEnabled(), false);
        process.env.REDIS_STATE_FAIL_CLOSED_ENABLED = prev;
    });
    console.log('  OK flag parse');

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — RedisState fail-closed\n');
    process.exit(failed ? 1 : 0);
})();
