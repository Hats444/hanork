#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    getWeekdayIso,
    getRefChannelPromoType,
    filterEntriesByWeekdayCalendar,
    isUrgencyStyle,
    recordUrgencyUse,
    urgencyCapReached,
    HANORK_STYLES_BY_DOW,
} = require('../src/data/marketingWeekdayCalendar');
const { buildEligibleEntries } = require('../src/data/marketingMarkdownVariants');

process.env.MARKETING_WEEKDAY_CALENDAR = '1';

assert.strictEqual(isUrgencyStyle('urgência suave'), true);
assert.strictEqual(isUrgencyStyle('confiança'), false);

const mockKv = { _m: new Map(), get(k) { return this._m.get(k) ?? null; }, set(k, v) { this._m.set(k, v); } };

const hanorkEntries = buildEligibleEntries('hanork', 'md', 'hanork', mockKv);
assert(hanorkEntries.length >= 10, 'hanork eligible pool');

const smmEntries = buildEligibleEntries('smm', 'md-smm', 'smm', mockKv);
assert(smmEntries.length >= 10, 'smm eligible pool');

const fakeHanork = [
    { id: 'md-001', variant: { style: 'confiança', fullBody: 'test' } },
    { id: 'md-003', variant: { style: 'urgência suave', fullBody: 'test' } },
];

const monFiltered = filterEntriesByWeekdayCalendar(fakeHanork, 'hanork', mockKv, new Date('2026-06-22T15:00:00Z'));
assert(monFiltered.some((e) => e.id === 'md-001'), 'mon keeps confiança');
assert(!monFiltered.some((e) => e.id === 'md-003'), 'mon excludes urgência');

recordUrgencyUse(mockKv);
recordUrgencyUse(mockKv);
assert.strictEqual(urgencyCapReached(mockKv), true);

assert(HANORK_STYLES_BY_DOW[1]?.includes('confiança'), 'mon styles defined');

console.log('test-marketing-weekday-calendar.js OK');
