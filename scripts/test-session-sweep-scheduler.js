#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    runSessionStateSweep,
    DEFAULT_SESSION_TTL_MS,
} = require('../src/jobs/schedulers/sessionStateSweepScheduler');

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

async function run() {
    console.log('\n=== Session state sweep scheduler ===\n');

    await test('TTL padrão 30 min', async () => {
        assert.strictEqual(DEFAULT_SESSION_TTL_MS, 30 * 60 * 1000);
    });

    await test('remove entradas expiradas de Map nativo', async () => {
        const now = Date.now();
        const m = new Map([
            ['a', { _ts: now - 40 * 60 * 1000 }],
            ['b', { _ts: now }],
        ]);
        await runSessionStateSweep(
            {
                prisma: { session: { cleanupExpired: async () => 0 } },
                log: { info: () => {}, error: () => {}, debug: () => {} },
                getNativeMaps: () => ({ testMap: m }),
                getRedisWrapped: () => ({}),
            },
            { sessionTtlMs: 30 * 60 * 1000 }
        );
        assert.strictEqual(m.has('a'), false);
        assert.strictEqual(m.has('b'), true);
    });

    await test('chama prisma.session.cleanupExpired', async () => {
        let called = false;
        const r = await runSessionStateSweep({
            prisma: {
                session: {
                    cleanupExpired: async () => {
                        called = true;
                        return 2;
                    },
                },
            },
            log: { info: () => {}, error: () => {}, debug: () => {} },
            getNativeMaps: () => ({}),
            getRedisWrapped: () => ({}),
        });
        assert.ok(called);
        assert.strictEqual(r.dbSessionsCleaned, 2);
    });

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — session sweep scheduler\n');
    process.exit(failed ? 1 : 0);
}

run();
