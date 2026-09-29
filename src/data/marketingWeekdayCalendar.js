'use strict';

const { CAMPAIGN_TIMEZONE } = require('../config/campaignConfig');

const KV_URGENCY_WEEK = 'marketing_urgency_uses_week';
const URGENCY_STYLE = 'urgência suave';
const MAX_URGENCY_PER_WEEK = 2;

/** 1=Seg … 7=Dom (ISO) */
const HANORK_STYLES_BY_DOW = {
    1: ['confiança', 'benefício'],
    3: ['social proof'],
    5: ['urgência suave'],
};

/** 2=Ter, 4=Qui — filtro por palavra-chave no corpo */
const SMM_KEYWORDS_BY_DOW = {
    2: ['instagram', 'telegram'],
    4: ['visualiza', 'curtida', 'curtidas', 'views', 'visualizações'],
};

function envFlag(name, defaultOn = false) {
    const raw = process.env[name];
    if (raw == null || raw === '') return defaultOn;
    const v = String(raw).trim().toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

function isWeekdayCalendarEnabled() {
    return envFlag('MARKETING_WEEKDAY_CALENDAR', true);
}

function isSalesRefDailyPromoEnabled() {
    return envFlag('SALES_REF_DAILY_PROMO', true);
}

function getLocalParts(date = new Date()) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: CAMPAIGN_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
    });
    const parts = fmt.formatToParts(date);
    const pick = (type) => parts.find((p) => p.type === type)?.value;
    const weekdayShort = pick('weekday');
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        year: pick('year'),
        month: pick('month'),
        day: pick('day'),
        weekday: weekdayMap[weekdayShort] ?? date.getDay(),
    };
}

/** 1=Seg … 7=Dom */
function getWeekdayIso(date = new Date()) {
    const w = getLocalParts(date).weekday;
    return w === 0 ? 7 : w;
}

function dayKey(date = new Date()) {
    const p = getLocalParts(date);
    return `${p.year}-${p.month}-${p.day}`;
}

function weekKey(date = new Date()) {
    const p = getLocalParts(date);
    const dayNum = parseInt(p.day, 10) || 1;
    const iso = getWeekdayIso(date);
    const weekNum = Math.floor((dayNum + iso - 1) / 7) + 1;
    return `${p.year}-${p.month}-W${weekNum}`;
}

function normalizeStyle(style) {
    return String(style || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function isUrgencyStyle(style) {
    return normalizeStyle(style).includes('urgencia');
}

function getUrgencyUsesThisWeek(kv) {
    try {
        const raw = kv.get?.(`${KV_URGENCY_WEEK}:${weekKey()}`);
        return raw ? parseInt(raw, 10) || 0 : 0;
    } catch {
        return 0;
    }
}

function recordUrgencyUse(kv) {
    const key = `${KV_URGENCY_WEEK}:${weekKey()}`;
    const next = getUrgencyUsesThisWeek(kv) + 1;
    kv.set?.(key, String(next));
    return next;
}

function urgencyCapReached(kv) {
    return getUrgencyUsesThisWeek(kv) >= MAX_URGENCY_PER_WEEK;
}

/** Tipo de promo no canal ref por dia (§2.2) */
function getRefChannelPromoType(date = new Date()) {
    const dow = getWeekdayIso(date);
    if (dow === 7) return 'smm';
    if (dow === 2 || dow === 4) return 'smm';
    return 'hanork';
}

function variantBodyText(variant) {
    return `${variant?.fullBody || ''} ${variant?.headline || ''} ${variant?.tgBody || ''} ${variant?.waBody || ''}`.toLowerCase();
}

function matchesHanorkStyles(variant, allowedStyles) {
    if (!allowedStyles?.length) return true;
    const v = normalizeStyle(variant?.style);
    return allowedStyles.some((a) => {
        const n = normalizeStyle(a);
        return v === n || v.includes(n) || n.includes(v);
    });
}

function matchesSmmKeywords(variant, keywords) {
    if (!keywords?.length) return true;
    const text = variantBodyText(variant);
    return keywords.some((kw) => text.includes(String(kw).toLowerCase()));
}

/**
 * @param {{ id: string, variant: object }[]} entries
 * @param {'hanork'|'smm'} promoType
 */
function filterEntriesByWeekdayCalendar(entries, promoType, kv, date = new Date()) {
    if (!isWeekdayCalendarEnabled() || !entries.length) return entries;

    const dow = getWeekdayIso(date);
    const cap = urgencyCapReached(kv);

    return entries.filter(({ variant }) => {
        const urgent = isUrgencyStyle(variant?.style);

        if (promoType === 'hanork') {
            if (urgent && cap) return false;
            const allowed = HANORK_STYLES_BY_DOW[dow];
            if (allowed?.length) {
                return matchesHanorkStyles(variant, allowed);
            }
            return !urgent;
        }

        if (urgent) return false;
        const keywords = SMM_KEYWORDS_BY_DOW[dow];
        if (keywords?.length) {
            return matchesSmmKeywords(variant, keywords);
        }
        return true;
    });
}

module.exports = {
    isWeekdayCalendarEnabled,
    isSalesRefDailyPromoEnabled,
    getLocalParts,
    getWeekdayIso,
    dayKey,
    weekKey,
    getRefChannelPromoType,
    filterEntriesByWeekdayCalendar,
    isUrgencyStyle,
    recordUrgencyUse,
    urgencyCapReached,
    getUrgencyUsesThisWeek,
    HANORK_STYLES_BY_DOW,
    SMM_KEYWORDS_BY_DOW,
    MAX_URGENCY_PER_WEEK,
};
