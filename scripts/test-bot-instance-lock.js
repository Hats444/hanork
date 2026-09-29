#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const mod = require('../src/modules/security/botInstanceLock');

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

console.log('\n=== bot instance lock ===\n');

test('isStaleLock com conteúdo inválido', () => {
    const had = fs.existsSync(mod.LOCK_FILE);
    const backup = had ? fs.readFileSync(mod.LOCK_FILE) : null;
    try {
        fs.writeFileSync(mod.LOCK_FILE, 'not-a-pid');
        assert.strictEqual(mod.isStaleLock(), true);
    } finally {
        mod.removeLockFileQuiet();
        if (backup) fs.writeFileSync(mod.LOCK_FILE, backup);
    }
});

test('isHanorkBotPid rejeita PID próprio', () => {
    assert.strictEqual(mod.isHanorkBotPid(process.pid), false);
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — bot instance lock\n');
process.exit(failed ? 1 : 0);
