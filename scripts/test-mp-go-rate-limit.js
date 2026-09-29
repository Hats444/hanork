#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { mpGoRateLimit, mpGoRateMap } = require('../src/modules/security/httpSecurity');

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

console.log('\n=== MP /go rate limit ===\n');

test('permite até o limite por IP', () => {
    mpGoRateMap.clear();
    process.env.MP_GO_RATE_LIMIT_PER_MIN = '3';
    const ip = '203.0.113.50';
    let status = null;
    const mkReq = () => ({
        headers: {},
        socket: { remoteAddress: ip },
    });
    const mkRes = () => ({
        status(c) { status = c; return this; },
        set() { return this; },
        send() {},
    });
    for (let i = 0; i < 3; i++) {
        status = null;
        let nextCalled = false;
        mpGoRateLimit(mkReq(), mkRes(), () => { nextCalled = true; });
        assert.strictEqual(nextCalled, true, `req ${i + 1}`);
    }
    status = null;
    let blocked = false;
    mpGoRateLimit(mkReq(), mkRes(), () => { blocked = true; });
    assert.strictEqual(status, 429);
    assert.strictEqual(blocked, false);
    delete process.env.MP_GO_RATE_LIMIT_PER_MIN;
});

test('bootMetrics snapshot', () => {
    const bootMetrics = require('../src/modules/health/bootMetrics');
    bootMetrics._reset();
    bootMetrics.markBootStart();
    const mid = bootMetrics.getBootSnapshot();
    assert.strictEqual(mid.bootComplete, 0);
    assert.ok(mid.bootDurationSeconds >= 0);
    bootMetrics.markBootReady();
    const done = bootMetrics.getBootSnapshot();
    assert.strictEqual(done.bootComplete, 1);
    assert.ok(done.bootDurationSeconds >= 0);
    bootMetrics._reset();
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — MP /go rate limit\n');
process.exit(failed ? 1 : 0);
