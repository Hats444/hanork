#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    isSmmBroadcastEnabled,
    mixSmmIntoProductQueue,
    formatSmmTelegramHtml,
    pickSmmVariant,
    SMM_QUEUE_MARKER,
} = require('../src/data/smmBroadcastVariants');

process.env.SMM_ENABLED = '1';
process.env.SMM_PUBLIC = '1';
process.env.AUTO_BROADCAST_SMM = '1';

assert.strictEqual(isSmmBroadcastEnabled(), true);

const mixed = mixSmmIntoProductQueue([1, 2, 3, 4, 5, 6]);
assert(mixed.includes(SMM_QUEUE_MARKER), 'smm marker in queue');

const html = formatSmmTelegramHtml(pickSmmVariant(), { username: 'hanork_bot' });
assert(html.includes('hanork_bot'), 'bot link');
assert(html.includes('SMM') || html.includes('servi'), 'smm content');

console.log('test-smm-broadcast-variants.js OK');
