'use strict';

const CatalogService = require('../services/catalogService');
const { smmPanel } = require('../helpers/smmPanelUi');
const {
    platformKeyboard,
    subcategoryKeyboard,
    serviceListKeyboard,
    serviceDetailKeyboard,
} = require('../keyboards/smmCatalogKeyboards');
const {
    CB,
    platformFromSlug,
    subFromSlug,
    platformSlug,
    subSlug,
} = require('../utils/smmCallbackData');
const { catalogNoticeKeyboard } = require('../keyboards/smmNoticeKeyboards');
const { formatServiceDetail } = require('../utils/smmTextFormat');
const { familyDisplayLabel } = require('../services/familyService');
const L = require('../utils/smmLabels');

async function sendPlatforms(ctx, Msg) {
    const rows = await CatalogService.getPlatforms();
    const active = rows.filter((r) => r.total > 0);
    if (!active.length) {
        return smmPanel(ctx, Msg, 'Nenhum serviço disponível no momento.', catalogNoticeKeyboard(), { screen: 'smm' });
    }
    const text =
        '<b>Comprar serviços — Hanork SMM</b>\n\n' +
        '<b>Passo 1 de 4</b> — Escolha a plataforma (Telegram, Instagram, TikTok…).\n' +
        'Depois você escolhe o tipo de serviço, informa o link e a quantidade.';
    return smmPanel(ctx, Msg, text, platformKeyboard(active), { screen: 'smm' });
}

async function sendSubcategories(ctx, Msg, platform) {
    const rows = CatalogService.listSubcategories(platform);
    const active = rows.filter((r) => r.total > 0);
    const text =
        `<b>${platform}</b>\n\n` +
        `<b>Passo 2 de 4</b> — Escolha o tipo de serviço (membros, curtidas, visualizações…).`;
    return smmPanel(ctx, Msg, text, subcategoryKeyboard(platform, active), { platform });
}

async function sendServiceList(ctx, Msg, platform, subcategory, page = 0) {
    const { items, hasMore } = CatalogService.listServices(platform, subcategory, page);
    if (!items.length) {
        return smmPanel(ctx, Msg, 'Nenhum serviço nesta categoria.', catalogNoticeKeyboard(), { platform });
    }
    const text =
        `<b>${platform}</b> › <b>${subcategory}</b>\n` +
        `<b>Passo 3 de 4</b> — Escolha o pacote (página ${page + 1}).\n\n` +
        'Toque no serviço para ver preço, mínimo e detalhes.';
    return smmPanel(ctx, Msg, text, serviceListKeyboard(platform, subcategory, items, page, hasMore), { platform });
}

async function sendServiceDetail(ctx, Msg, serviceId, backPlatform, backSub) {
    const svc = CatalogService.getService(serviceId);
    if (!svc) {
        return smmPanel(ctx, Msg, 'Serviço não encontrado ou indisponível.', catalogNoticeKeyboard(), { screen: 'smm' });
    }
    const backCb = CB.list(
        platformSlug(backPlatform || svc.platform),
        subSlug(backSub || svc.subcategory),
        0
    );
    const text = formatServiceDetail(svc);
    return smmPanel(ctx, Msg, text, serviceDetailKeyboard(svc, backCb), { platform: svc.platform });
}

async function sendSearchResults(ctx, Msg, query) {
    const items = CatalogService.search(query, 15);
    if (!items.length) {
        return smmPanel(
            ctx,
            Msg,
            `Nenhum resultado para <b>${query}</b>.\n\n<i>Tente: seguidores instagram, curtidas tiktok…</i>`,
            catalogNoticeKeyboard()
        );
    }
    const lines = items.map((s, i) => {
        const label = s.service_family
            ? familyDisplayLabel(s.service_family, s.subcategory)
            : s.name.slice(0, 60);
        return `${i + 1}. <b>${s.platform}</b> › ${label}\n   R$ ${Number(s.sale_price).toFixed(2)}/1k`;
    });
    const rows = items.slice(0, 8).map((s) => {
        const label = s.service_family
            ? familyDisplayLabel(s.service_family, s.subcategory)
            : s.subcategory;
        return [{ text: `${s.platform} · ${label}`.slice(0, 40), callback_data: CB.view(s.id) }];
    });
    rows.push([{ text: L.HOME, callback_data: CB.HOME }]);
    return smmPanel(
        ctx,
        Msg,
        `<b>Resultados</b> (${items.length})\n\n${lines.slice(0, 8).join('\n\n')}`,
        { inline_keyboard: rows }
    );
}

module.exports = {
    sendPlatforms,
    sendSubcategories,
    sendServiceList,
    sendServiceDetail,
    sendSearchResults,
    platformFromSlug,
    subFromSlug,
};
