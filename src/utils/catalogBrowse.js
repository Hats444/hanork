'use strict';

const {
    resolveProductFormat,
    formatCatalogKey,
    formatBucketLabel,
} = require('./productFormat');
const { catalogButtonLabel } = require('./productListing');
const ProductSearchService = require('../services/ProductSearchService');
const { NAV_BTN } = require('../telegram/menus/menuCopy');

const PER_PAGE = 5;

const SORT_KEYS = {
    new: 'new',
    asc: 'asc',
    desc: 'desc',
    name: 'name',
};

/** @deprecated — catálogo usa formatos dinâmicos por extensão real */
const FORMAT_BUCKETS = [];

function getFormatBucketKey(product) {
    return formatCatalogKey(resolveProductFormat(product));
}

function groupProductsByFormat(products) {
    const groups = {};
    for (const p of products || []) {
        const key = getFormatBucketKey(p);
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    }
    return groups;
}

/** Ordem no hub: assinatura → mais produtos → outros por último */
function getOrderedFormatKeys(groups) {
    const keys = Object.keys(groups || {}).filter((k) => (groups[k] || []).length > 0);
    keys.sort((a, b) => {
        if (a === 'assinatura') return -1;
        if (b === 'assinatura') return 1;
        if (a === 'outros') return 1;
        if (b === 'outros') return -1;
        return groups[b].length - groups[a].length;
    });
    return keys;
}

function bucketLabel(key) {
    return formatBucketLabel(key);
}

function filterBySearch(products, query) {
    return ProductSearchService.filterProducts(products, query);
}

function sortProducts(products, sortKey = SORT_KEYS.new) {
    const list = [...(products || [])];
    switch (sortKey) {
        case SORT_KEYS.asc:
            return list.sort((a, b) => Number(a.price) - Number(b.price));
        case SORT_KEYS.desc:
            return list.sort((a, b) => Number(b.price) - Number(a.price));
        case SORT_KEYS.name:
            return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt'));
        case SORT_KEYS.new:
        default:
            return list.sort((a, b) => Number(b.id) - Number(a.id));
    }
}

function prepareCatalogProducts(products, view = {}) {
    let list = [...(products || [])];
    if (view.query) {
        return filterBySearch(list, view.query);
    }
    return sortProducts(list, view.sort || SORT_KEYS.new);
}

function slicePage(items, page) {
    const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const start = safePage * PER_PAGE;
    return {
        items: items.slice(start, start + PER_PAGE),
        page: safePage,
        totalPages,
    };
}

function listCallback(page, sort) {
    return `cat_list_${page}_${sort}`;
}

function parseListCallback(data) {
    const m = data.match(/^cat_list_(\d+)_([a-z]+)$/);
    if (m) return { page: parseInt(m[1], 10) || 0, sort: m[2] };
    const legacy = data.match(/^cat_list_(\d+)$/);
    if (legacy) return { page: parseInt(legacy[1], 10) || 0, sort: SORT_KEYS.new };
    return null;
}

/**
 * Hub: lista completa + busca + um chip por formato (MP4, ZIP, JPG…).
 */
function buildHubRows(groups) {
    const rows = [
        [{ text: NAV_BTN.verLista, callback_data: listCallback(0, SORT_KEYS.new) }],
        [{ text: NAV_BTN.buscar, callback_data: 'cat_search' }],
    ];

    const chips = getOrderedFormatKeys(groups).map((key) => ({
        key,
        label: `${bucketLabel(key)} (${groups[key].length})`,
    }));

    if (!chips.length) {
        rows.push([{ text: 'Sem formatos', callback_data: 'noop' }]);
    }

    for (let i = 0; i < chips.length; i += 2) {
        const row = chips.slice(i, i + 2).map((c) => ({
            text: c.label,
            callback_data: `cat_f_${c.key}_0`,
        }));
        rows.push(row);
    }

    rows.push([{ text: NAV_BTN.menu, callback_data: 'home' }]);
    return rows;
}

function buildHubText(productCount, query) {
    if (query) {
        return (
            `<b>Busca no catálogo</b>\n\n` +
            `Termo: <code>${query}</code>\n` +
            `${productCount} resultado(s)\n\n` +
            `<i>Toque em um produto abaixo.</i>`
        );
    }
    return (
        `<b>Catálogo</b>\n\n` +
        `${productCount} produto(s) disponível(is).\n\n` +
        `<b>Lista</b> — todos os produtos\n` +
        `<b>Buscar</b> — por nome ou descrição\n` +
        `<b>Formato</b> — filtros rápidos (ZIP, MP4, PDF…)\n\n` +
        `<i>Toque em um produto para ver detalhes e comprar.</i>`
    );
}

function buildListRows(products, page, sort = SORT_KEYS.new) {
    const { items, page: safePage, totalPages } = slicePage(products, page);
    const rows = items.map((p) => [{ text: catalogButtonLabel(p, 14), callback_data: `p_${p.id}` }]);

    const sortRow = [
        { text: sort === SORT_KEYS.asc ? NAV_BTN.sortMenorActive : NAV_BTN.sortMenor, callback_data: listCallback(safePage, SORT_KEYS.asc) },
        { text: sort === SORT_KEYS.desc ? NAV_BTN.sortMaiorActive : NAV_BTN.sortMaior, callback_data: listCallback(safePage, SORT_KEYS.desc) },
    ];
    const sortRow2 = [
        { text: sort === SORT_KEYS.name ? NAV_BTN.sortAzActive : NAV_BTN.sortAz, callback_data: listCallback(safePage, SORT_KEYS.name) },
        { text: sort === SORT_KEYS.new ? NAV_BTN.sortRecentesActive : NAV_BTN.sortRecentes, callback_data: listCallback(safePage, SORT_KEYS.new) },
    ];
    rows.push(sortRow, sortRow2);

    const nav = [];
    if (safePage > 0) nav.push({ text: 'Anterior', callback_data: listCallback(safePage - 1, sort) });
    nav.push({ text: NAV_BTN.formatos, callback_data: 'cat_hub' });
    if (safePage < totalPages - 1) nav.push({ text: 'Próximo', callback_data: listCallback(safePage + 1, sort) });
    rows.push(nav);
    rows.push([{ text: NAV_BTN.menu, callback_data: 'home' }]);
    return { rows, safePage, totalPages };
}

function buildListText(page, totalPages, query) {
    let t = query ? `<b>Resultados da busca</b>` : `<b>Lista completa</b>`;
    if (totalPages > 1) t += ` <i>${page + 1}/${totalPages}</i>`;
    t += `\n\n<i>Toque em um produto. Use Anterior e Próximo para ver mais páginas.</i>`;
    return t;
}

function buildFormatRows(products, formatKey, page) {
    const { items, page: safePage, totalPages } = slicePage(products, page);
    const rows = items.map((p) => [{ text: catalogButtonLabel(p, 14), callback_data: `p_${p.id}` }]);

    const nav = [];
    if (safePage > 0) nav.push({ text: 'Anterior', callback_data: `cat_f_${formatKey}_${safePage - 1}` });
    nav.push({ text: NAV_BTN.formatos, callback_data: 'cat_hub' });
    if (safePage < totalPages - 1) nav.push({ text: 'Próximo', callback_data: `cat_f_${formatKey}_${safePage + 1}` });
    rows.push(nav);
    rows.push([{ text: NAV_BTN.listaCompleta, callback_data: listCallback(0, SORT_KEYS.new) }, { text: NAV_BTN.menu, callback_data: 'home' }]);
    return { rows, safePage, totalPages };
}

function buildFormatText(formatKey, page, totalPages, count) {
    if (!count) {
        return (
            `<b>${bucketLabel(formatKey)}</b>\n\n` +
            `Nenhum produto neste formato agora.\n\n` +
            `<i>Veja a lista completa ou outro formato.</i>`
        );
    }
    let t = `<b>${bucketLabel(formatKey)}</b>`;
    if (totalPages > 1) t += ` <i>${page + 1}/${totalPages}</i>`;
    t += `\n\n${count} produto(s)\n<i>Use Anterior e Próximo para navegar entre as páginas.</i>`;
    return t;
}

function parseCatalogCallback(data) {
    if (data === 'cat_hub') return { mode: 'hub' };
    if (data === 'cat_search') return { mode: 'search_prompt' };
    const list = parseListCallback(data);
    if (list) return { mode: 'list', page: list.page, sort: list.sort };
    const fmt = data.match(/^cat_f_([a-z0-9]+)_(\d+)$/);
    if (fmt) return { mode: 'format', formatKey: fmt[1], page: parseInt(fmt[2], 10) || 0 };
    const legacy = data.match(/^cat_pg_(\d+)$/);
    if (legacy) return { mode: 'list', page: parseInt(legacy[1], 10) || 0, sort: SORT_KEYS.new };
    return null;
}

module.exports = {
    PER_PAGE,
    SORT_KEYS,
    FORMAT_BUCKETS,
    groupProductsByFormat,
    getFormatBucketKey,
    getOrderedFormatKeys,
    bucketLabel,
    filterBySearch,
    sortProducts,
    prepareCatalogProducts,
    buildHubRows,
    buildHubText,
    buildListRows,
    buildListText,
    buildFormatRows,
    buildFormatText,
    parseCatalogCallback,
    parseListCallback,
    listCallback,
};
