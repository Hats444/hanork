'use strict';

const { isCampaignOrchestratorEnabled } = require('../../config/campaignConfig');
const { campaignTypeNow } = require('../../services/campaign/campaignTimeWindows');

function waContentTypeAllowed({ smmBroadcast, virtuoBroadcast, productId } = {}) {
    if (!isCampaignOrchestratorEnabled()) return true;
    const windowType = campaignTypeNow();
    if (smmBroadcast) return windowType === 'smm';
    if (virtuoBroadcast) return windowType === 'hanork' || windowType === 'smm';
    if (productId) return windowType === 'hanork';
    return true;
}

function randomWaPromoDelayMs(source) {
    const base = parseInt(process.env.ZERO_DIVU_AUTO_PROMO_DELAY_MS || '480000', 10);
    const spread = parseInt(process.env.ZERO_DIVU_AUTO_PROMO_DELAY_SPREAD_MS || '360000', 10);
    const jitter = Math.floor(Math.random() * Math.max(spread, 60000));
    return Math.max(60000, base + jitter);
}

/**
 * Enfileira promo WA após slot de campanha (mesma lógica do pós-runCycle, com filtro de janela).
 * @param {object} slotCtx — { slot, channel, hour } para roteamento dual (Fase 2)
 */
async function enqueueWaAfterCampaign(service, built, result, source, slotCtx = {}) {
    const deps = service._zeroDivuDeps;
    if (!deps) return { skipped: true, reason: 'no_deps' };

    const { isZeroDivuEnabled } = require('./config');
    if (!isZeroDivuEnabled()) return { skipped: true, reason: 'wa_disabled' };

    if (!result?.success) return { skipped: true, reason: 'broadcast_failed' };

    const payload = {
        smmBroadcast: Boolean(built?.smmBroadcast),
        virtuoBroadcast: Boolean(built?.virtuoBroadcast),
        productId: built?.productId || result?.productId,
    };
    if (!waContentTypeAllowed(payload)) {
        (deps.logger || console).info?.(
            '[ZeroDivu] WA promo adiada — janela de campanha',
            { category: 'HANORK', module: 'WA', window: campaignTypeNow(), ...payload }
        );
        return { skipped: true, reason: 'window_mismatch' };
    }

    const ZeroTwoAi = require('../../services/ZeroTwoAiService');
    const { catalogUsesAi } = require('./hanorkAutoSync');
    const skipFullSync =
        catalogUsesAi() &&
        (ZeroTwoAi.isRateLimited?.() || ZeroTwoAi.isBootGuardActive?.());

    if (!skipFullSync && typeof deps.loadProducts === 'function') {
        const { syncHanorkCatalogToZero } = require('./hanorkAutoSync');
        syncHanorkCatalogToZero(deps).catch((e) => {
            (deps.logger || console).warn?.('[ZeroDivu] Sync pós-campanha:', e.message);
        });
    }

    const cycleKey = service.getCount?.() || Date.now();
    const delayMs = randomWaPromoDelayMs(source);

    const { resolveSessionForCampaign } = require('./waSessionRouter');
    const sessionId = resolveSessionForCampaign({
        hour: slotCtx.hour ?? slotCtx.slot?.hour,
        channel: slotCtx.channel,
        smmBroadcast: payload.smmBroadcast,
        productId: payload.productId,
    });

    if (payload.productId) {
        const { isDivulgacaoEligibleProduct } = require('./divulgacaoCatalog');
        const prods = await deps.loadProducts?.().catch(() => []);
        const picked = (prods || []).find((p) => Number(p.id) === Number(payload.productId));
        if (!picked || !isDivulgacaoEligibleProduct(picked)) {
            return { skipped: true, reason: 'product_ineligible' };
        }
        const { enqueueProductPromoById } = require('./promo');
        const r = await enqueueProductPromoById(deps, payload.productId, {
            source: `hanork_campaign_${source || 'auto'}`,
            idempotencyKey: `campaign-bcast-${sessionId}-${payload.productId}-${cycleKey}`,
            delayMs,
            processNow: false,
            skipWindowCheck: true,
            sessionId,
        });
        if (r?.ok) {
            const mins = Math.max(1, Math.round(delayMs / 60000));
            (deps.logger || console).info?.(
                `[ZeroDivu] Campanha → WA Status agendado (~${mins} min): ${r.productName || picked.name}`,
                { category: 'HANORK', module: 'WA', productId: payload.productId, delayMs, sessionId }
            );
        }
        return r;
    }

    if (payload.smmBroadcast) {
        const { enqueueSmmPromo } = require('./promo');
        const r = await enqueueSmmPromo(deps, {
            source: `hanork_campaign_smm_${source || 'auto'}`,
            idempotencyKey: `campaign-bcast-smm-${sessionId}-${cycleKey}`,
            delayMs,
            processNow: false,
            skipWindowCheck: true,
            sessionId,
        });
        if (r?.ok) {
            const mins = Math.max(1, Math.round(delayMs / 60000));
            (deps.logger || console).info?.(
                `[ZeroDivu] Campanha SMM → WA agendado (~${mins} min)`,
                { category: 'HANORK', module: 'WA', delayMs, sessionId }
            );
        }
        return r;
    }

    if (payload.virtuoBroadcast) {
        const { enqueueVirtuoPromo } = require('./promo');
        const r = await enqueueVirtuoPromo(deps, {
            source: `hanork_campaign_virtuo_${source || 'auto'}`,
            idempotencyKey: `campaign-bcast-virtuo-${sessionId}-${cycleKey}`,
            delayMs,
            processNow: false,
            skipWindowCheck: true,
            sessionId,
        });
        if (r?.ok) {
            const mins = Math.max(1, Math.round(delayMs / 60000));
            (deps.logger || console).info?.(
                `[ZeroDivu] Campanha Virtuo → WA agendado (~${mins} min)`,
                { category: 'HANORK', module: 'WA', delayMs, sessionId }
            );
        }
        return r;
    }

    return { skipped: true, reason: 'no_content' };
}

module.exports = {
    waContentTypeAllowed,
    enqueueWaAfterCampaign,
};
