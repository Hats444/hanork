#!/usr/bin/env node
'use strict';

const broadcastRateLimit = require('../src/services/broadcastRateLimit');
const { BROADCAST_MAX_PER_DESTINATION } = require('../src/config/broadcastConfig');

const store = new Map();
const dbRaw = () => ({
    prepare(sql) {
        if (sql.includes('SELECT')) {
            return {
                get(key) {
                    const value = store.get(key);
                    return value != null ? { value } : undefined;
                },
            };
        }
        return {
            run(key, value) {
                store.set(key, value);
            },
        };
    },
});

const chatId = -1001234567890;
let fail = 0;

function assert(cond, msg) {
    if (!cond) {
        fail++;
        console.error('FAIL:', msg);
    } else {
        console.log('OK:', msg);
    }
}

let gate = broadcastRateLimit.canSendAuto(dbRaw, chatId);
assert(gate.ok === true, 'empty history allows send');
assert(gate.remaining === BROADCAST_MAX_PER_DESTINATION, 'full quota remaining');

for (let i = 0; i < BROADCAST_MAX_PER_DESTINATION; i++) {
    broadcastRateLimit.recordAutoSend(dbRaw, chatId);
}
gate = broadcastRateLimit.canSendAuto(dbRaw, chatId);
assert(gate.ok === false, 'blocked after max posts');
assert(gate.count === BROADCAST_MAX_PER_DESTINATION, 'count at max');

assert(broadcastRateLimit.isScheduledBroadcastSource('auto'), 'auto is scheduled');
assert(broadcastRateLimit.isScheduledBroadcastSource('button_run_now'), 'button_run_now is scheduled');
assert(!broadcastRateLimit.isScheduledBroadcastSource('manual_bridge'), 'manual_bridge is not scheduled');
assert(!broadcastRateLimit.isScheduledBroadcastSource('flash_sale'), 'flash_sale is not scheduled');

const oldTs = Date.now() - broadcastRateLimit.BROADCAST_RATE_WINDOW_MS - 60000;
store.set(
    `${broadcastRateLimit.KV_PREFIX}${chatId}`,
    JSON.stringify([oldTs, Date.now() - 1000])
);
gate = broadcastRateLimit.canSendAuto(dbRaw, chatId);
assert(gate.ok === true, 'expired window entry frees slot');
assert(gate.count === 1, 'only recent entry counts');

console.log(fail ? `\n${fail} failure(s)` : '\nAll broadcast rate-limit tests passed');
process.exit(fail ? 1 : 0);
