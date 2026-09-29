'use strict';

const { HANORK_PRODUCT_ID } = require('../../constants/hanorkProduct');
const { isSmmBroadcastEnabled } = require('../../data/smmBroadcastVariants');

/**
 * Gerador centralizado de conteúdo de campanha (HANORK | SMM).
 * Reutiliza variantes existentes — tom profissional, sem promessas irreais.
 */
async function buildForCampaignType(service, type) {
    const t = String(type || '').toLowerCase();

    if (t === 'smm') {
        if (!isSmmBroadcastEnabled()) return service._buildCatalogFallback();
        return service._buildSmmMessage();
    }

    const active = await service._getEligibleProducts();
    const hanorkPlatform = active.find((p) => Number(p.id) === HANORK_PRODUCT_ID);
    if (hanorkPlatform) {
        return service._buildProductMessage(hanorkPlatform);
    }

    const p = await service._pickHanorkProduct();
    if (p) return service._buildProductMessage(p);
    return service._buildCatalogFallback();
}

module.exports = { buildForCampaignType };
