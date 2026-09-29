#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    runCartCleanup,
    DEFAULT_INTERVAL_MS,
    DEFAULT_OLDER_THAN_MINUTES,
} = require('../src/jobs/schedulers/cartCleanupScheduler');

let failed = 0;
function test(name, fn) {
    return (async () => {
        try {
            await fn();
            console.log('  OK', name);
        } catch (e) {
            failed++;
            console.error('  FAIL', name + ':', e.message);
        }
    })();
}

const logs = [];
const mockLog = {
    info: (...args) => logs.push(['info', ...args]),
    error: (...args) => logs.push(['error', ...args]),
};

async function run() {
    console.log('\n=== Cart cleanup scheduler ===\n');

    await test('constantes padrão 30 min', async () => {
        assert.strictEqual(DEFAULT_INTERVAL_MS, 1800000);
        assert.strictEqual(DEFAULT_OLDER_THAN_MINUTES, 30);
    });

    await test('runCartCleanup chama prisma.cart.cleanupOld(30)', async () => {
        let calledWith = null;
        const prisma = {
            cart: {
                cleanupOld: async (mins) => {
                    calledWith = mins;
                    return { deleted: 0 };
                },
            },
        };
        await runCartCleanup(prisma, mockLog, 30);
        assert.strictEqual(calledWith, 30);
    });

    await test('loga apenas quando deleted > 0', async () => {
        logs.length = 0;
        const prisma = {
            cart: { cleanupOld: async () => ({ deleted: 3 }) },
        };
        const r = await runCartCleanup(prisma, mockLog, 30);
        assert.strictEqual(r.deleted, 3);
        assert.ok(logs.some((l) => l[0] === 'info' && String(l[1]).includes('3')));
    });

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — cart cleanup scheduler\n');
    process.exit(failed ? 1 : 0);
}

run();
