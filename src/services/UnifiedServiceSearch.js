'use strict';

const { Markup } = require('telegraf');
const { escapeTelegramHtml } = require('../telegram/htmlEscape');

function moduleAccess(uid, isAdmin) {
    let smm = false;
    let virtuo = false;
    try {
        smm =
            require('../modules/smm/smmEnabled').isSmmEnabled() &&
            require('../modules/smm/smmAccess').canUseSmmCatalog(uid, isAdmin);
    } catch {
        /* ignore */
    }
    try {
        virtuo =
            require('../modules/virtuo/virtuoEnabled').isVirtuoEnabled() &&
            require('../modules/virtuo/virtuoAccess').canUseVirtuoCatalog(uid, isAdmin);
    } catch {
        /* ignore */
    }
    return { smm, virtuo };
}

function searchSmm(query, limit = 10) {
    try {
        const CatalogService = require('../modules/smm/services/catalogService');
        return CatalogService.search(query, limit) || [];
    } catch {
        return [];
    }
}

function searchVirtuo(query, limit = 10) {
    try {
        const VirtuoCatalogService = require('../modules/virtuo/services/catalogService');
        const resolved = VirtuoCatalogService.resolveParsedQuery(query);
        if (resolved.mode === 'service_country' || resolved.mode === 'global') {
            return (resolved.countries || []).slice(0, limit);
        }
        if (resolved.mode === 'service_only') {
            return (
                VirtuoCatalogService.listCountriesForService(resolved.serviceCode, 0, limit).countries || []
            );
        }
        return (VirtuoCatalogService.searchGlobal(query, limit).countries || []).slice(0, limit);
    } catch {
        return [];
    }
}

function smmButtonLabel(s) {
    const { familyDisplayLabel } = require('../modules/smm/services/familyService');
    const sub = s.service_family ? familyDisplayLabel(s.service_family, s.subcategory) : s.subcategory;
    return `📈 ${s.platform} · ${sub}`.slice(0, 42);
}

/**
 * Busca unificada: SMM + Números SMS (Virtuo).
 * @returns {Promise<{ handled: boolean }>}
 */
async function dispatch(ctx, Msg, query, isAdmin) {
    const q = String(query || '').trim();
    if (q.length < 2) {
        await Msg.reply(ctx, 'Digite pelo menos <b>2 caracteres</b> para buscar.', null, { parse_mode: 'HTML' });
        return { handled: true };
    }

    const { smm, virtuo } = moduleAccess(ctx.from?.id, isAdmin);
    const smmItems = smm ? searchSmm(q, 10) : [];
    const virtuoItems = virtuo ? searchVirtuo(q, 10) : [];

    if (!smmItems.length && !virtuoItems.length) {
        const rows = [];
        if (virtuo) {
            rows.push([
                { text: '🔍 Buscar número SMS', callback_data: 'virtuo:srch:hub' },
                { text: '📱 Números SMS', callback_data: 'virtuo:home' },
            ]);
        }
        if (smm) {
            rows.push([{ text: '📈 Serviços SMM', callback_data: 'smm:home' }]);
        }
        rows.push([{ text: '🏠 Menu', callback_data: 'menu:home' }]);
        const safeQ = escapeTelegramHtml(q);
        await Msg.reply(
            ctx,
            `🔍 Nenhum resultado em <b>SMM</b> nem <b>Números SMS</b> para <code>${safeQ}</code>.\n\n` +
                '<i>Ex.: seguidores instagram · curtidas tiktok · whatsapp brasil · telegram portugal</i>',
            rows.length ? Markup.inlineKeyboard(rows) : null,
            { parse_mode: 'HTML' }
        );
        return { handled: true };
    }

    if (smmItems.length && !virtuoItems.length) {
        const { sendSearchResults } = require('../modules/smm/handlers/smmUiHandlers');
        await sendSearchResults(ctx, Msg, q);
        return { handled: true };
    }

    if (virtuoItems.length && !smmItems.length) {
        const { dispatchVirtuoTextQuery } = require('../modules/virtuo/handlers/virtuoUiHandlers');
        await dispatchVirtuoTextQuery(ctx, Msg, q, { mode: 'hub' });
        return { handled: true };
    }

    const { CB: SmmCB } = require('../modules/smm/utils/smmCallbackData');
    const { serviceTitle } = require('../modules/virtuo/handlers/virtuoUiHandlers');
    const { formatMoney } = require('../modules/virtuo/utils/virtuoTextFormat');

    const lines = [];
    const rows = [];

    lines.push(`<b>📈 SMM</b> — ${smmItems.length} resultado(s)`);
    for (const s of smmItems.slice(0, 4)) {
        const { familyDisplayLabel } = require('../modules/smm/services/familyService');
        const label = s.service_family ? familyDisplayLabel(s.service_family, s.subcategory) : s.name.slice(0, 48);
        lines.push(
            `• ${escapeTelegramHtml(s.platform)} › ${escapeTelegramHtml(label)} — R$ ${Number(s.sale_price).toFixed(2)}/1k`
        );
    }
    for (const s of smmItems.slice(0, 5)) {
        rows.push([{ text: smmButtonLabel(s), callback_data: SmmCB.view(s.id) }]);
    }

    lines.push(`\n<b>📱 Números SMS</b> — ${virtuoItems.length} resultado(s)`);
    for (const c of virtuoItems.slice(0, 4)) {
        lines.push(
            `• ${escapeTelegramHtml(serviceTitle(c.service_code))} · ${escapeTelegramHtml(c.country_name)} — ${formatMoney(c.sale_price)}`
        );
    }
    for (const c of virtuoItems.slice(0, 5)) {
        rows.push([
            {
                text: `📱 ${serviceTitle(c.service_code)} ${c.country_name}`.slice(0, 42),
                callback_data: `virtuo:cty:${c.id}:0`,
            },
        ]);
    }

    rows.push([
        { text: '📈 SMM', callback_data: 'smm:home' },
        { text: '📱 SMS', callback_data: 'virtuo:home' },
    ]);
    rows.push([{ text: '🏠 Menu', callback_data: 'menu:home' }]);

    const safeQ = escapeTelegramHtml(q);
    await Msg.reply(
        ctx,
        `<b>🔍 Resultados — ${safeQ}</b>\n\n${lines.join('\n')}`,
        Markup.inlineKeyboard(rows),
        { parse_mode: 'HTML' }
    );
    return { handled: true };
}

module.exports = {
    dispatch,
    searchSmm,
    searchVirtuo,
    moduleAccess,
};
