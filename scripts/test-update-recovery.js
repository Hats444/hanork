'use strict';

/**
 * Smoke: UpdateRecoveryStore — persistência, dedup e fila retry.
 */
const assert = require('assert');

process.env.HANORK_DB_PATH = process.env.HANORK_DB_PATH || require('os').tmpdir() + '/hanork-test-update-recovery.db';

const fs = require('fs');
const testDb = process.env.HANORK_DB_PATH;
try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
} catch {
    /* ignore */
}

const store = require('../src/telegram/updateRecovery/UpdateRecoveryStore');

function ok(label) {
    console.log(`  ✓ ${label}`);
}

ok('last update id inicia em 0');
assert.strictEqual(store.readLastUpdateId(), 0);

store.markProcessed(100);
ok('markProcessed persiste');
assert.strictEqual(store.readLastUpdateId(), 100);
assert.strictEqual(store.isProcessed(100), true);
assert.strictEqual(store.isProcessed(99), false);

store.markProcessed(105);
assert.strictEqual(store.telegramOffsetForRecovery(), 106);

const update = { update_id: 200, message: { message_id: 1, text: 'oi', chat: { id: 1 }, date: 1 } };
store.enqueueRetry(update, 'test err');
ok('fila retry');
assert.strictEqual(store.getRetryQueue().length, 1);

store.markProcessed(200);
store.dequeueRetry(200);
assert.strictEqual(store.getRetryQueue().length, 0);

const stats = store.getStats();
assert.strictEqual(stats.lastUpdateId, 105);
ok('stats ok');

console.log('\nUpdateRecovery store: OK\n');

try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
} catch {
    /* ignore */
}
