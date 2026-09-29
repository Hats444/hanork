'use strict';

const { Markup } = require('telegraf');
const { CB, platformSlug, subSlug } = require('../utils/smmCallbackData');
const { truncate } = require('../utils/smmTextFormat');
const {
    platformDisplayLabel,
    subcategoryDisplayLabel,
    serviceDisplayLabel,
} = require('../services/displayLabelService');
const { PLATFORMS_DISPLAY_ORDER } = require('../constants/platforms');
const L = require('../utils/smmLabels');

function platformKeyboard(platformRows) {
    const byName = new Map(platformRows.map((r) => [r.platform, r.total]));
    const ordered = [];
    for (const name of PLATFORMS_DISPLAY_ORDER) {
        if ((byName.get(name) || 0) > 0) ordered.push(name);
    }
    for (const { platform, total } of platformRows) {
        if (total > 0 && !ordered.includes(platform)) ordered.push(platform);
    }
    const rows = [];
    let row = [];
    for (const name of ordered) {
        const count = byName.get(name) || 0;
        row.push({
            text: `${platformDisplayLabel(name)} (${count})`,
            callback_data: CB.platform(platformSlug(name)),
        });
        if (row.length === 2) {
            rows.push(row);
            row = [];
        }
    }
    if (row.length) rows.push(row);
    rows.push([{ text: L.TERMS, callback_data: 'terms:summary' }]);
    rows.push([{ text: L.MENU, callback_data: 'menu:home' }]);
    return Markup.inlineKeyboard(rows);
}

function subcategoryKeyboard(platform, subRows) {
    const known = new Map(subRows.map((r) => [r.subcategory, r.total]));
    const rows = [];
    let row = [];
    const ordered = [...known.keys()].sort((a, b) => (known.get(b) || 0) - (known.get(a) || 0));
    for (const sub of ordered) {
        const count = known.get(sub) || 0;
        if (count <= 0) continue;
        row.push({
            text: `${subcategoryDisplayLabel(sub, platform)} (${count})`,
            callback_data: CB.sub(platformSlug(platform), subSlug(sub)),
        });
        if (row.length === 2) {
            rows.push(row);
            row = [];
        }
    }
    if (row.length) rows.push(row);
    rows.push([
        { text: L.PLATFORMS, callback_data: CB.HOME },
        { text: L.MENU, callback_data: 'menu:home' },
    ]);
    return Markup.inlineKeyboard(rows);
}

function serviceListKeyboard(platform, subcategory, items, page, hasMore) {
    const p = platformSlug(platform);
    const s = subSlug(subcategory);
    const rows = items.map((svc) => {
        const label = serviceDisplayLabel(svc, { max: 36 });
        return [
            {
                text: `${truncate(label, 36)} · R$${Number(svc.sale_price).toFixed(2)}`,
                callback_data: CB.view(svc.id),
            },
        ];
    });
    const nav = [];
    if (page > 0) {
        nav.push({ text: L.PREV, callback_data: CB.list(p, s, page - 1) });
    }
    if (hasMore) {
        nav.push({ text: L.NEXT, callback_data: CB.list(p, s, page + 1) });
    }
    if (nav.length) rows.push(nav);
    rows.push([
        { text: L.CATEGORIES, callback_data: CB.platform(p) },
        { text: L.MENU, callback_data: 'menu:home' },
    ]);
    return Markup.inlineKeyboard(rows);
}

function serviceDetailKeyboard(svc, backCb) {
    return Markup.inlineKeyboard([
        [{ text: L.BUY, callback_data: CB.buy(svc.id) }],
        [
            { text: L.BACK, callback_data: backCb },
            { text: L.MENU, callback_data: 'menu:home' },
        ],
        [{ text: L.TERMS, callback_data: 'terms:summary' }],
    ]);
}

module.exports = {
    platformKeyboard,
    subcategoryKeyboard,
    serviceListKeyboard,
    serviceDetailKeyboard,
};
