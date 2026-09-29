#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    runPendingPurchaseCleanup,
    DEFAULT_INTERVAL_MS,
    DEFAULT_EXPIRE_WINDOW_MS,
} = require('../src/jobs/schedulers/pendingPurchaseCleanupScheduler');

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

async function run() {
    console.log('\n=== Pending purchase cleanup scheduler ===\n');

    await test('intervalo padrão 15 min', async () => {
        assert.strictEqual(DEFAULT_INTERVAL_MS, 900000);
        assert.strictEqual(DEFAULT_EXPIRE_WINDOW_MS, 3600000);
    });

    await test('deleteExpired recebe now - 1h (contrato legado)', async () => {
        const fixedNow = 1_700_000_000_000;
        let receivedLimit = null;
        const prisma = {
            pendingPurchase: {
                deleteExpired: async (limit) => {
                    receivedLimit = limit;
                    return 0;
                },
            },
        };
        await runPendingPurchaseCleanup(prisma, { info() {}, error() {} }, fixedNow);
        assert.strictEqual(receivedLimit, fixedNow - DEFAULT_EXPIRE_WINDOW_MS);
    });

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — pending purchase cleanup scheduler\n');
    process.exit(failed ? 1 : 0);
}

run();
