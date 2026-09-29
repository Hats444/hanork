'use strict';

const { Markup } = require('telegraf');
const Msg = require('./Msg');
const catalogBrowse = require('../utils/catalogBrowse');

/**
 * Monta texto e teclado do catálogo.
 * @param {object[]} allProducts — produtos brutos da loja
 * @param {{ mode: string, page?: number, formatKey?: string, sort?: string, query?: string }} view
 */
function buildCatalogView(allProducts, view = { mode: 'hub' }) {
    const mode = view.mode || 'hub';
    const products = catalogBrowse.prepareCatalogProducts(allProducts, view);
    const groups = catalogBrowse.groupProductsByFormat(allProducts);

    if (mode === 'hub') {
        const display = view.query
            ? catalogBrowse.prepareCatalogProducts(allProducts, { query: view.query })
            : allProducts;
        return {
            text: catalogBrowse.buildHubText(display.length, view.query),
            rows: view.query && display.length
                ? catalogBrowse.buildListRows(display, 0, view.sort || catalogBrowse.SORT_KEYS.new).rows
                : catalogBrowse.buildHubRows(groups),
        };
    }

    if (mode === 'list') {
        const page = view.page || 0;
        const sort = view.sort || catalogBrowse.SORT_KEYS.new;
        if (!products.length) {
            return {
                text:
                    `<b>Lista de produtos</b>\n\n` +
                    (view.query
                        ? `Nenhum resultado para <code>${view.query}</code>.\n\nTente outro termo ou veja todos os formatos.`
                        : 'Nenhum produto disponível.'),
                rows: [
                    [{ text: 'Buscar', callback_data: 'cat_search' }],
                    [{ text: 'Formatos', callback_data: 'cat_hub' }],
                    [{ text: 'Menu principal', callback_data: 'home' }],
                ],
            };
        }
        const { rows, safePage, totalPages } = catalogBrowse.buildListRows(products, page, sort);
        return {
            text: catalogBrowse.buildListText(safePage, totalPages, view.query),
            rows,
        };
    }

    if (mode === 'format') {
        const formatKey = view.formatKey || 'outros';
        const subset = catalogBrowse.prepareCatalogProducts(groups[formatKey] || [], { sort: view.sort });
        const page = view.page || 0;
        if (!subset.length) {
            return {
                text: catalogBrowse.buildFormatText(formatKey, 0, 1, 0),
                rows: [
                    [{ text: 'Voltar aos formatos', callback_data: 'cat_hub' }],
                    [{ text: 'Lista completa', callback_data: catalogBrowse.listCallback(0, catalogBrowse.SORT_KEYS.new) }],
                    [{ text: 'Menu principal', callback_data: 'home' }],
                ],
            };
        }
        const { rows, safePage, totalPages } = catalogBrowse.buildFormatRows(subset, formatKey, page);
        return {
            text: catalogBrowse.buildFormatText(formatKey, safePage, totalPages, subset.length),
            rows,
        };
    }

    return buildCatalogView(allProducts, { mode: 'hub' });
}

async function sendCatalogView(ctx, allProducts, view, opts = {}) {
    const { text, rows } = buildCatalogView(allProducts, view);
    const kb = Markup.inlineKeyboard(rows);

    if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => {});
    }

    const fn = opts.replyWithMenuPhoto;
    if (typeof fn === 'function') {
        return fn(ctx, text, kb);
    }

    return Msg.replaceMenu(ctx, text, kb, { useMenuPhoto: true });
}

module.exports = {
    buildCatalogView,
    sendCatalogView,
};
