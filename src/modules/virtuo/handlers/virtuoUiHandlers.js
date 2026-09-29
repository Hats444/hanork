'use strict';



const VirtuoCatalogService = require('../services/catalogService');

const { virtuoPanel } = require('../helpers/virtuoPanelUi');

const {

    homeKeyboard,

    countryKeyboard,

    countrySearchResultsKeyboard,

    globalSearchResultsKeyboard,

    confirmKeyboard,

    serviceTitle,

} = require('../keyboards/virtuoCatalogKeyboards');

const { formatQuoteBlock, formatMoney } = require('../utils/virtuoTextFormat');

const { CB } = require('../utils/virtuoCallbackData');

const L = require('../utils/virtuoLabels');

const { escapeTelegramHtml } = require('../../../telegram/htmlEscape');

const { setVirtuoSearch } = require('../state/virtuoSearchMode');



function breadcrumb(parts) {

    return parts.filter(Boolean).join(' › ');

}



async function sendHome(ctx, Msg) {
    const apps = VirtuoCatalogService.listFeaturedApps();

    if (!apps.length) {
        const { requireBotContext } = require('../../../telegram/callbacks/BotContext');
        let isAdmin = false;
        try {
            const deps = requireBotContext(['isAdmin']);
            isAdmin = Boolean(deps.isAdmin?.(ctx.from?.id));
        } catch {
            /* optional */
        }

        const rows = [[{ text: L.MENU, callback_data: 'menu:home' }]];
        if (isAdmin) {
            rows.unshift([{ text: L.SYNC, callback_data: CB.sync }]);
        }

        return virtuoPanel(
            ctx,
            Msg,
            '<b>📱 Números SMS</b>\n\n' +
                'Catálogo ainda não sincronizado.\n\n' +
                (isAdmin
                    ? '<i>Admin: use o botão Sincronizar ou /virtuo_sync.</i>'
                    : '<i>O catálogo será atualizado em breve — tente novamente mais tarde.</i>'),
            { inline_keyboard: rows }
        );
    }

    const text =

        '<b>📱 Números SMS — Hanork</b>\n\n' +

        `<i>${breadcrumb(['Menu', 'Números SMS'])}</i>\n\n` +

        '<b>Passo 1 de 3</b> — Escolha o app ou use <b>Buscar</b>.\n\n' +

        '<i>WhatsApp, Telegram, Instagram e dezenas de apps · qualquer país.</i>\n\n' +

        '💡 Ex.: <code>/numeros whatsapp brasil</code> · <code>/numeros telegram portugal</code> · <code>/numeros indonesia</code>';

    return virtuoPanel(ctx, Msg, text, homeKeyboard(apps));

}



async function sendCountries(ctx, Msg, serviceCode, page = 0, pageSize = 8) {

    const code = String(serviceCode || '').toLowerCase();

    const { countries, total } = VirtuoCatalogService.listCountriesForService(code, page, pageSize);

    if (!total || !countries.length) {

        return virtuoPanel(

            ctx,

            Msg,

            `<b>${escapeTelegramHtml(serviceTitle(code))}</b>\n\n` +

                'Nenhum país disponível no momento.',

            homeKeyboard(VirtuoCatalogService.listFeaturedApps())

        );

    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const safePage = Math.min(Math.max(0, page), totalPages - 1);

    const pageHint =

        totalPages > 1 ? `\n<i>Página ${safePage + 1} de ${totalPages} · ◀️ ▶️ ou busque por nome</i>` : '';

    const text =

        `<b>📱 ${escapeTelegramHtml(breadcrumb(['Menu', 'Números', serviceTitle(code), 'Países']))}</b>\n\n` +

        `<b>Passo 2 de 3</b> — Escolha o país.\n` +

        `<i>Preço por número · estoque entre parênteses.</i>${pageHint}`;

    return virtuoPanel(ctx, Msg, text, countryKeyboard(code, countries, safePage, pageSize, total));

}



async function promptGlobalSearch(ctx, Msg) {

    const uid = ctx.from?.id;

    if (uid) setVirtuoSearch(uid, { mode: 'hub' });

    const text =

        '<b>🔍 Buscar app ou país</b>\n\n' +

        'Digite o <b>app</b>, o <b>país</b> ou os dois:\n\n' +

        '• <code>whatsapp brasil</code>\n' +

        '• <code>telegram portugal</code>\n' +

        '• <code>indonesia</code> (todos os apps)\n\n' +

        '<i>Envie /cancelar para voltar.</i>';

    return virtuoPanel(ctx, Msg, text, {

        inline_keyboard: [

            [{ text: L.APPS, callback_data: CB.HOME }],

            [{ text: L.MENU, callback_data: 'menu:home' }],

        ],

    });

}



async function promptCountrySearch(ctx, Msg, serviceCode) {

    const code = String(serviceCode || '').toLowerCase();

    if (code === 'hub') return promptGlobalSearch(ctx, Msg);

    const uid = ctx.from?.id;

    if (uid) setVirtuoSearch(uid, { mode: 'service', serviceCode: code });

    const text =

        `<b>🔍 Buscar país — ${escapeTelegramHtml(serviceTitle(code))}</b>\n\n` +

        'Digite o nome do país (ex.: Brasil, Portugal, Indonésia, EUA).\n\n' +

        '<i>Envie /cancelar para voltar.</i>';

    return virtuoPanel(ctx, Msg, text, {

        inline_keyboard: [

            [{ text: L.COUNTRIES, callback_data: CB.countriesPage(code, 0) }],

            [{ text: L.APPS, callback_data: CB.HOME }, { text: L.MENU, callback_data: 'menu:home' }],

        ],

    });

}



async function sendNoSearchResults(ctx, Msg, query, backKb) {

    const safeQ = escapeTelegramHtml(String(query || '').trim());

    return virtuoPanel(

        ctx,

        Msg,

        `<b>🔍 Nenhum resultado para «${safeQ}»</b>\n\n` +

            'Tente outro app ou país — ex.: <code>whatsapp espanha</code>, <code>telegram</code>.\n\n' +

            `<i>${breadcrumb(['Menu', 'Números SMS'])}</i>`,

        backKb || {

            inline_keyboard: [

                [{ text: L.SEARCH_GLOBAL, callback_data: CB.countrySearch('hub') }],

                [{ text: L.APPS, callback_data: CB.HOME }],

                [{ text: L.MENU, callback_data: 'menu:home' }],

            ],

        }

    );

}



async function sendCountrySearchResults(ctx, Msg, serviceCode, query) {

    const code = String(serviceCode || '').toLowerCase();

    const q = String(query || '').trim();

    const { countries } = VirtuoCatalogService.searchCountriesForService(code, q, 12);

    if (!countries.length) {

        return sendNoSearchResults(ctx, Msg, q, {

            inline_keyboard: [

                [{ text: L.SEARCH_COUNTRY, callback_data: CB.countrySearch(code) }],

                [{ text: L.COUNTRIES, callback_data: CB.countriesPage(code, 0) }],

                [{ text: L.MENU, callback_data: 'menu:home' }],

            ],

        });

    }

    if (countries.length === 1) {

        return sendConfirm(ctx, Msg, countries[0].id, 0);

    }



    const safeQ = escapeTelegramHtml(q);

    const lines = countries

        .slice(0, 8)

        .map((c) => `• ${escapeTelegramHtml(c.country_name)} — ${formatMoney(c.sale_price)}`)

        .join('\n');



    const text =

        `<b>🔍 Resultados — ${escapeTelegramHtml(serviceTitle(code))}</b>\n\n` +

        `Busca: <b>${safeQ}</b> · ${countries.length} opção(ões)\n\n` +

        lines +

        (countries.length > 8 ? `\n\n<i>+${countries.length - 8} no teclado abaixo</i>` : '');



    return virtuoPanel(ctx, Msg, text, countrySearchResultsKeyboard(code, countries));

}



async function sendGlobalSearchResults(ctx, Msg, query, countries) {

    const q = String(query || '').trim();

    const rows = countries || VirtuoCatalogService.searchGlobal(q, 15).countries;

    if (!rows.length) {

        return sendNoSearchResults(ctx, Msg, q);

    }

    if (rows.length === 1) {

        return sendConfirm(ctx, Msg, rows[0].id, 0);

    }



    const safeQ = escapeTelegramHtml(q);

    const lines = rows

        .slice(0, 8)

        .map((c) => {

            const svc = escapeTelegramHtml(serviceTitle(c.service_code));

            return `• ${svc} · ${escapeTelegramHtml(c.country_name)} — ${formatMoney(c.sale_price)}`;

        })

        .join('\n');



    const text =

        `<b>🔍 Resultados — números SMS</b>\n\n` +

        `Busca: <b>${safeQ}</b> · ${rows.length} opção(ões)\n\n` +

        lines +

        (rows.length > 8 ? `\n\n<i>+${rows.length - 8} no teclado abaixo</i>` : '');



    return virtuoPanel(ctx, Msg, text, globalSearchResultsKeyboard(rows));

}



/** @param {{ mode: 'hub'|'service', serviceCode?: string }} pending */

async function dispatchVirtuoTextQuery(ctx, Msg, text, pending = { mode: 'hub' }) {

    const q = String(text || '').trim();

    if (!q || q.length < 2) {

        return virtuoPanel(ctx, Msg, 'Digite pelo menos 2 caracteres para buscar.', {

            inline_keyboard: [[{ text: L.APPS, callback_data: CB.HOME }]],

        });

    }



    if (pending.mode === 'service' && pending.serviceCode) {

        return sendCountrySearchResults(ctx, Msg, pending.serviceCode, q);

    }



    const resolved = VirtuoCatalogService.resolveParsedQuery(q);

    if (resolved.mode === 'service_only') {

        return sendCountries(ctx, Msg, resolved.serviceCode, 0);

    }

    if (resolved.mode === 'service_country') {

        if (!resolved.countries.length) {

            return sendNoSearchResults(ctx, Msg, q);

        }

        return sendGlobalSearchResults(ctx, Msg, q, resolved.countries);

    }

    return sendGlobalSearchResults(ctx, Msg, q, resolved.countries);

}



async function sendConfirm(ctx, Msg, serviceId, countryPage = 0) {

    const quote = VirtuoCatalogService.quote(serviceId);

    if (quote.error) {

        return virtuoPanel(ctx, Msg, 'Serviço indisponível.', {

            inline_keyboard: [[{ text: L.APPS, callback_data: CB.HOME }]],

        });

    }

    const svc = quote.service;

    const safePage = Math.max(0, Number(countryPage) || 0);

    const text =

        `<b>📱 ${escapeTelegramHtml(breadcrumb(['Menu', 'Números', serviceTitle(svc.service_code), svc.country_name]))}</b>\n\n` +

        `<b>Passo 3 de 3</b> — Confirme antes do pagamento.\n\n` +

        formatQuoteBlock(svc, quote.sale_total) +

        `\n\n<b>Confirmar compra por ${formatMoney(quote.sale_total)}?</b>`;

    return virtuoPanel(ctx, Msg, text, confirmKeyboard(serviceId, svc.service_code, safePage));

}



async function sendUserOrders(ctx, Msg, telegramId) {

    const VirtuoOrderRepository = require('../repositories/virtuoOrderRepository');

    const rows = VirtuoOrderRepository.listByTelegram(telegramId, 8);

    if (!rows.length) {

        return virtuoPanel(ctx, Msg, '<b>📦 Meus números SMS</b>\n\n<i>Nenhum pedido ainda.</i>', {

            inline_keyboard: [[{ text: L.BACK, callback_data: CB.HOME }]],

        });

    }

    const lines = rows.map((r) => {

        const st = String(r.status).toUpperCase();

        const code = r.sms_code ? ` · código <code>${escapeTelegramHtml(r.sms_code)}</code>` : '';

        return `• ${escapeTelegramHtml(r.service_name)} (${escapeTelegramHtml(r.country_name)})\n  ${st}${code}`;

    });

    return virtuoPanel(

        ctx,

        Msg,

        `<b>📦 Meus números SMS</b>\n\n${lines.join('\n\n')}`,

        { inline_keyboard: [[{ text: L.BACK, callback_data: CB.HOME }]] }

    );

}



module.exports = {

    sendHome,

    sendCountries,

    promptCountrySearch,

    promptGlobalSearch,

    sendCountrySearchResults,

    sendGlobalSearchResults,

    dispatchVirtuoTextQuery,

    sendConfirm,

    sendUserOrders,

    serviceTitle,

};


