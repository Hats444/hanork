'use strict';

const { Markup } = require('telegraf');
const { CB, platformSlug, subSlug } = require('../utils/smmCallbackData');
const { truncate, PLATFORM_ICONS } = require('../utils/smmTextFormat');
const { PLATFORMS_DISPLAY_ORDER } = require('../constants/platforms');

function platformKeyboard(platformRows) {
    const known = new Set(platformRows.map((r) => r.platform));
    const rows = [];
    let row = [];
    for (const name of PLATFORMS_DISPLAY_ORDER) {
        if (!known.has(name)) continue;
        const icon = PLATFORM_ICONS[name] || '🔹';
        const count = platformRows.find((r) => r.platform === name)?.total || 0;
        row.push({
            text: `${icon} ${name} (${count})`,
            callback_data: CB.platform(platformSlug(name)),
        });
        if (row.length === 2) {
            rows.push(row);
            row = [];
        }
    }
    if (row.length) rows.push(row);
    rows.push([{ text: '🏠 Menu', callback_data: 'home' }]);
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
            text: `${sub} (${count})`,
            callback_data: CB.sub(platformSlug(platform), subSlug(sub)),
        });
        if (row.length === 2) {
            rows.push(row);
            row = [];
        }
    }
    if (row.length) rows.push(row);
    rows.push([
        { text: '◀️ Plataformas', callback_data: CB.HOME },
        { text: '🏠 Menu', callback_data: 'home' },
    ]);
    return Markup.inlineKeyboard(rows);
}

function serviceListKeyboard(platform, subcategory, items, page, hasMore) {
    const p = platformSlug(platform);
    const s = subSlug(subcategory);
    const rows = items.map((svc) => [
        {
            text: `${truncate(svc.name, 36)} · R$${Number(svc.sale_price).toFixed(2)}`,
            callback_data: CB.view(svc.id),
        },
    ]);
    const nav = [];
    if (page > 0) {
        nav.push({ text: '◀️ Anterior', callback_data: CB.list(p, s, page - 1) });
    }
    if (hasMore) {
        nav.push({ text: 'Próxima ▶️', callback_data: CB.list(p, s, page + 1) });
    }
    if (nav.length) rows.push(nav);
    rows.push([
        { text: '◀️ Categorias', callback_data: CB.platform(p) },
        { text: '🏠 Menu', callback_data: 'home' },
    ]);
    return Markup.inlineKeyboard(rows);
}

function serviceDetailKeyboard(svc, backCb) {
    return Markup.inlineKeyboard([
        [{ text: '🛒 Comprar', callback_data: CB.buy(svc.id) }],
        [{ text: '◀️ Voltar', callback_data: backCb }, { text: '🏠 Menu', callback_data: 'home' }],
    ]);
}

module.exports = {
    platformKeyboard,
    subcategoryKeyboard,
    serviceListKeyboard,
    serviceDetailKeyboard,
};
