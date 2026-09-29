#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    runCommandLimiterCleanup,
    runHttpRateMapCleanup,
    DEFAULT_HTTP_ENTRY_MAX_AGE_MS,
    DEFAULT_COMMAND_INTERVAL_MS,
    DEFAULT_HTTP_INTERVAL_MS,
} = require('../src/jobs/schedulers/rateLimitCleanupScheduler');

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

console.log('\n=== Rate limit cleanup scheduler ===\n');

test('intervalos padrão', () => {
    assert.strictEqual(DEFAULT_COMMAND_INTERVAL_MS, 600000);
    assert.strictEqual(DEFAULT_HTTP_INTERVAL_MS, 300000);
    assert.strictEqual(DEFAULT_HTTP_ENTRY_MAX_AGE_MS, 120000);
});

test('commandLimiter.cleanup remove entradas antigas', () => {
    const limiter = {
        history: new Map([
            ['1:/start', [Date.now() - 700000]],
            ['2:/start', [Date.now()]],
        ]),
        cleanup() {
            const now = Date.now();
            for (const [key, timestamps] of this.history) {
                const filtered = timestamps.filter((ts) => now - ts < 600000);
                if (filtered.length === 0) this.history.delete(key);
                else this.history.set(key, filtered);
            }
        },
    };
    runCommandLimiterCleanup(limiter);
    assert.strictEqual(limiter.history.has('1:/start'), false);
    assert.strictEqual(limiter.history.has('2:/start'), true);
});

test('httpRateMap remove IPs expirados', () => {
    const map = new Map([
        ['1.1.1.1', { count: 1, ts: Date.now() - 200000 }],
        ['2.2.2.2', { count: 1, ts: Date.now() }],
    ]);
    const r = runHttpRateMapCleanup(map, 120000);
    assert.strictEqual(r.removed, 1);
    assert.strictEqual(map.has('1.1.1.1'), false);
    assert.strictEqual(map.has('2.2.2.2'), true);
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — rate limit cleanup scheduler\n');
process.exit(failed ? 1 : 0);
