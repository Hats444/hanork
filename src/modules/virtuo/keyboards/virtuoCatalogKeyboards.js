'use strict';

const { CB } = require('../utils/virtuoCallbackData');
const L = require('../utils/virtuoLabels');
const { formatMoney } = require('../utils/virtuoTextFormat');
const { featuredByCode } = require('../constants/featuredServices');

function homeKeyboard(apps) {
    const rows = [[{ text: L.SEARCH_GLOBAL, callback_data: CB.countrySearch('hub') }]];
    for (let i = 0; i < apps.length; i += 2) {
        const chunk = apps.slice(i, i + 2).map((app) => ({
            text: `${app.emoji} ${app.name}`,
            callback_data: CB.service(app.code),
        }));
        rows.push(chunk);
    }
    rows.push([{ text: L.MY_ORDERS, callback_data: CB.orders }]);
    rows.push([{ text: L.MENU, callback_data: 'menu:home' }]);
    return { inline_keyboard: rows };
}

function countryKeyboard(serviceCode, countries, page = 0, pageSize = 8, total = null) {
    const totalItems = total != null ? total : countries.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const rows = [[{ text: L.SEARCH_COUNTRY, callback_data: CB.countrySearch(serviceCode) }]];

    for (const c of countries) {
        rows.push([
            {
                text: `${c.country_name} · ${formatMoney(c.sale_price)} (${c.available})`,
                callback_data: CB.country(c.id, safePage),
            },
        ]);
    }

    const nav = [];
    if (safePage > 0) {
        nav.push({ text: L.PREV, callback_data: CB.countriesPage(serviceCode, safePage - 1) });
    }
    if ((safePage + 1) * pageSize < totalItems) {
        nav.push({ text: L.NEXT, callback_data: CB.countriesPage(serviceCode, safePage + 1) });
    }
    if (nav.length) rows.push(nav);

    rows.push([
        { text: L.APPS, callback_data: CB.HOME },
        { text: L.MENU, callback_data: 'menu:home' },
    ]);
    return { inline_keyboard: rows };
}

function countryLabel(row) {
    const f = featuredByCode(row.service_code);
    const prefix = f ? `${f.emoji} ` : '';
    return `${prefix}${row.country_name} · ${formatMoney(row.sale_price)} (${row.available})`;
}

function countrySearchResultsKeyboard(serviceCode, countries) {
    const rows = countries.map((c) => [
        {
            text: countryLabel(c),
            callback_data: CB.country(c.id, 0),
        },
    ]);
    rows.push([
        { text: L.SEARCH_COUNTRY, callback_data: CB.countrySearch(serviceCode) },
        { text: L.COUNTRIES, callback_data: CB.countriesPage(serviceCode, 0) },
    ]);
    rows.push([
        { text: L.APPS, callback_data: CB.HOME },
        { text: L.MENU, callback_data: 'menu:home' },
    ]);
    return { inline_keyboard: rows };
}

function globalSearchResultsKeyboard(countries) {
    const rows = countries.map((c) => [
        {
            text: countryLabel(c),
            callback_data: CB.country(c.id, 0),
        },
    ]);
    rows.push([
        { text: L.SEARCH_GLOBAL, callback_data: CB.countrySearch('hub') },
        { text: L.APPS, callback_data: CB.HOME },
    ]);
    rows.push([{ text: L.MENU, callback_data: 'menu:home' }]);
    return { inline_keyboard: rows };
}

function confirmKeyboard(serviceId, serviceCode, countryPage = 0) {
    return {
        inline_keyboard: [
            [{ text: L.CONFIRM, callback_data: CB.buy(serviceCode, serviceId) }],
            [
                { text: L.COUNTRIES, callback_data: CB.countriesPage(serviceCode, countryPage) },
                { text: L.MENU, callback_data: 'menu:home' },
            ],
        ],
    };
}

function serviceTitle(serviceCode) {
    const f = featuredByCode(serviceCode);
    return f ? `${f.emoji} ${f.name}` : serviceCode.toUpperCase();
}

module.exports = {
    homeKeyboard,
    countryKeyboard,
    countrySearchResultsKeyboard,
    globalSearchResultsKeyboard,
    confirmKeyboard,
    serviceTitle,
    countryLabel,
};
