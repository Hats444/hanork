#!/usr/bin/env node
'use strict';

/**
 * V4 QW-1 — garante DB Zero Divu separado do hanork.db por padrão.
 */
require('../src/config/env');

const assert = require('assert');
const path = require('path');
const { ZERO_DIVU_CONFIG, useSharedHanorkDb } = require('../src/plugins/zero-divu/config');

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

console.log('\n=== Zero Divu DB config (QW-1) ===\n');

test('useSharedHanorkDb=false por padrão', () => {
    assert.strictEqual(useSharedHanorkDb(), false);
    assert.strictEqual(ZERO_DIVU_CONFIG.useSharedHanorkDb, false);
});

test('workerDb não aponta para hanork.db', () => {
    const workerDb = ZERO_DIVU_CONFIG.zeroDivuDbPath;
    assert.ok(workerDb, 'zeroDivuDbPath definido');
    assert.ok(!/hanork\.db$/i.test(workerDb), `esperado zero-divu.db, got ${workerDb}`);
    assert.ok(/zero-divu\.db$/i.test(workerDb), workerDb);
});

test('hanorkDb e workerDb são paths distintos', () => {
    assert.notStrictEqual(
        path.resolve(ZERO_DIVU_CONFIG.hanorkDbPath),
        path.resolve(ZERO_DIVU_CONFIG.zeroDivuDbPath)
    );
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — Zero Divu DB separado\n');
process.exit(failed ? 1 : 0);
