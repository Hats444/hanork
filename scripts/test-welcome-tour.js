#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    shouldAutoStartWelcomeTour,
    isWelcomeTourAutoEnabled,
    TOTAL_STEPS,
} = require('../src/telegram/commands/user/userWelcomeTour');

assert.strictEqual(TOTAL_STEPS, 2, 'tour deve ter 2 passos');

process.env.WELCOME_TOUR_AUTO = '0';
assert.strictEqual(isWelcomeTourAutoEnabled(), false);
assert.strictEqual(
    shouldAutoStartWelcomeTour({}, { isNew: true, payload: '', isAdmin: false, isGroupChat: false }),
    false,
    'auto tour off by default'
);

process.env.WELCOME_TOUR_AUTO = '1';
assert.strictEqual(isWelcomeTourAutoEnabled(), true);
assert.strictEqual(
    shouldAutoStartWelcomeTour({}, { isNew: true, payload: '', isAdmin: false, isGroupChat: false }),
    true,
    'auto tour on when env=1'
);

console.log('test-welcome-tour.js OK');
