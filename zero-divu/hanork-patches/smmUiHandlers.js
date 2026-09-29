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
const {
    platformDisplayLabel,
    serviceDisplayLabel,
    categoryBreadcrumb,
} = require('../services/displayLabelService');
const { STALE_CATALOG_MESSAGE } = require('../validators/smmActionValidator');
const { buildPlatformIntro, formatSearchPrice } = require('../services/purchaseGuideService');
const L = require('../utils/smmLabels');

async function sendPlatforms(ctx, Msg) {
    const rows = await CatalogService.getPlatforms();
    const active = rows.filter((r) => r.total > 0);
    if (!active.length) {
        return smmPanel(ctx, Msg, 'Nenhum serviço disponível no momento.', catalogNoticeKeyboard(), { screen: 'smm' });
    }
    const text =
        '<b>Comprar serviços — Hanork SMM</b>\n\n' +
        '<b>Etapa 1</b> — Escolha a plataforma.\n' +
        '<b>Etapa 2</b> — Tipo de serviço.\n' +
        '<b>Etapa 3</b> — Escolha o pacote e leia as instruções.\n\n' +
        '<i>Depois de tocar em <b>Comprar</b>, siga os passos na tela (dados ou link → pagamento).</i>';
    return smmPanel(ctx, Msg, text, platformKeyboard(active), { screen: 'smm' });
}

async function sendSubcategories(ctx, Msg, platform) {
    if (!platform) {
        return smmPanel(ctx, Msg, STALE_CATALOG_MESSAGE, catalogNoticeKeyboard(), { screen: 'smm' });
    }
    const rows = CatalogService.listSubcategories(platform);
    const active = rows.filter((r) => r.total > 0);
    const intro = buildPlatformIntro(platform);
    const text =
        `<b>${platformDisplayLabel(platform)}</b>\n\n` +
        `<i>${intro}</i>\n\n` +
        `<b>Etapa 2 de 3</b> — Escolha o tipo de serviço.`;
    return smmPanel(ctx, Msg, text, subcategoryKeyboard(platform, active), { platform });
}

async function sendServiceList(ctx, Msg, platform, subcategory, page = 0) {
    if (!platform || !subcategory) {
        return smmPanel(ctx, Msg, STALE_CATALOG_MESSAGE, catalogNoticeKeyboard(), { screen: 'smm' });
    }
    const { items, hasMore } = CatalogService.listServices(platform, subcategory, page);
    if (!items.length) {
        return smmPanel(ctx, Msg, 'Nenhum serviço nesta categoria.', catalogNoticeKeyboard(), { platform });
    }
    const text =
        `${categoryBreadcrumb(platform, subcategory)}\n` +
        `<b>Etapa 3 de 3</b> — Escolha o pacote (página ${page + 1}).\n\n` +
        'Toque no serviço para ver preço e instruções, depois <b>Comprar</b>.';
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
            `Nenhum resultado para <b>${query}</b>.\n\n<i>Tente: seguidores instagram, curtidas tiktok, iptv…</i>`,
            catalogNoticeKeyboard()
        );
    }
    const lines = items.map((s, i) => {
        const label = serviceDisplayLabel(s, { max: 60 });
        return `${i + 1}. ${label}\n   ${formatSearchPrice(s)}`;
    });
    const rows = items.slice(0, 8).map((s) => {
        const label = serviceDisplayLabel(s, { max: 36 });
        return [{ text: label.slice(0, 40), callback_data: CB.view(s.id) }];
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
