#!/usr/bin/env node
'use strict';

require('../src/config/env');

const assert = require('assert');
const RedisStateMod = require('../src/modules/state/RedisState');
const { StateManager, isPendingPurchaseIndexEnabled } = require('../src/modules/state/StateManager');

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

console.log('\n=== Pending purchase index (5.2) ===\n');

(async () => {
    process.env.PENDING_PURCHASE_INDEX_ENABLED = '1';
    process.env.REDIS_STATE_FAIL_CLOSED_ENABLED = '0';
    RedisStateMod.resetInstance();
    const rs = RedisStateMod.getInstance();
    rs.useFallback = true;
    rs.redis = null;

    const sm = StateManager.getInstance();

    await test('setPendingPurchase indexa orderId', async () => {
        await sm.setPendingPurchase('chat-1', { orderId: 'ord-99', items: [{ id: 1 }] }, 60);
        const idx = await rs.get('pending_idx', 'ord-99');
        assert.strictEqual(idx, 'chat-1');
    });

    await test('findPendingPurchaseByOrderId via índice O(1)', async () => {
        const p = await sm.findPendingPurchaseByOrderId('ord-99');
        assert.strictEqual(p.orderId, 'ord-99');
        assert.strictEqual(p.items[0].id, 1);
    });

    await test('deletePendingPurchase remove índice', async () => {
        await sm.deletePendingPurchase('chat-1');
        const idx = await rs.get('pending_idx', 'ord-99');
        assert.strictEqual(idx, null);
        const p = await sm.findPendingPurchaseByOrderId('ord-99');
        assert.strictEqual(p, null);
    });

    test('index flag default on', () => {
        delete process.env.PENDING_PURCHASE_INDEX_ENABLED;
        assert.strictEqual(isPendingPurchaseIndexEnabled(), true);
    });

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — pending purchase index\n');
    process.exit(failed ? 1 : 0);
})();
