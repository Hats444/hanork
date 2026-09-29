'use strict';

const { CAMPAIGN_TIMEZONE, slotWindowMs, groupSlots, pvSlots } = require('../../config/campaignConfig');

function getLocalParts(date = new Date()) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: CAMPAIGN_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const pick = (type) => parts.find((p) => p.type === type)?.value;
    return {
        year: pick('year'),
        month: pick('month'),
        day: pick('day'),
        hour: parseInt(pick('hour') || '0', 10),
        minute: parseInt(pick('minute') || '0', 10),
    };
}

function dayKey(date = new Date()) {
    const p = getLocalParts(date);
    return `${p.year}-${p.month}-${p.day}`;
}

/** Manhã 00–11 HANORK · Tarde/noite 12–23 SMM */
function campaignTypeForHour(hour) {
    const h = Number(hour);
    if (!Number.isFinite(h)) return 'hanork';
    return h < 12 ? 'hanork' : 'smm';
}

function campaignTypeNow(date = new Date()) {
    return campaignTypeForHour(getLocalParts(date).hour);
}

function isSlotDue(slotHour, now = new Date()) {
    const p = getLocalParts(now);
    if (p.hour !== slotHour) return false;
    const window = slotWindowMs();
    const minutesIntoHour = p.minute * 60 * 1000;
    return minutesIntoHour < window;
}

function getDueGroupSlots(now = new Date()) {
    return groupSlots().filter((s) => isSlotDue(s.hour, now));
}

function getDuePvSlots(now = new Date()) {
    return pvSlots().filter((s) => isSlotDue(s.hour, now));
}

function groupSlotKey(day, hour) {
    return `tg_group:${day}:${hour}`;
}

function pvSlotKey(day, type, hour) {
    return `tg_pv:${type}:${day}:${hour}`;
}

module.exports = {
    getLocalParts,
    dayKey,
    campaignTypeForHour,
    campaignTypeNow,
    isSlotDue,
    getDueGroupSlots,
    getDuePvSlots,
    groupSlotKey,
    pvSlotKey,
};
