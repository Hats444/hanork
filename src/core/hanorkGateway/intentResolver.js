'use strict';

/**
 * Prediz rota de callback (B2 U1) — mesma ordem que router.js, sem executar handlers.
 */
const {
    normalizeCallbackData,
    delegatePaymentNamespaceToLegacy,
    shouldDelegateToLegacyBotAction,
} = require('../../telegram/callbacks/legacyPatterns');

const CRITICAL_NAMESPACES = new Set([
    'payment',
    'downloads',
    'order',
    'cart',
    'menu',
    'admin',
    'flash',
    'affiliate',
]);

function parseIntentId(data, pattern) {
    if (pattern) return pattern.replace(/\*/g, 'param');
    const parts = String(data || '').split(':');
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
    if (/^pp_/.test(data)) return 'payment:pix:legacy';
    if (/^pc_/.test(data)) return 'payment:card:legacy';
    if (/^check_/.test(data)) return 'payment:check:legacy';
    if (/^p_\d+$/.test(data)) return 'catalog:product:legacy';
    if (/^a_/.test(data)) return 'admin:panel:legacy';
    if (/^bcast_/.test(data)) return 'admin:broadcast:legacy';
    return String(data || 'unknown').slice(0, 48);
}

function isCriticalIntent(intentId) {
    const ns = String(intentId || '').split(':')[0];
    return CRITICAL_NAMESPACES.has(ns) || /^payment:/.test(intentId);
}

/**
 * @returns {{ route: 'legacy_payment'|'legacy'|'registry'|'legacy_action', intentId: string, critical: boolean, normalized: string }}
 */
function predictCallbackRoute(rawData, registry) {
    const raw = String(rawData || '');
    const normalized = normalizeCallbackData(raw) || raw;
    let data = normalized;

    if (delegatePaymentNamespaceToLegacy(data)) {
        return {
            route: 'legacy_payment',
            intentId: parseIntentId(data, null),
            critical: true,
            normalized: data,
        };
    }

    if (shouldDelegateToLegacyBotAction(data)) {
        return {
            route: 'legacy',
            intentId: parseIntentId(data, null),
            critical: isCriticalIntent(parseIntentId(data, null)),
            normalized: data,
        };
    }

    if (registry && typeof registry.resolve === 'function') {
        const resolved = registry.resolve(data);
        if (resolved?.handler) {
            return {
                route: 'registry',
                intentId: parseIntentId(data, resolved.pattern),
                critical: isCriticalIntent(parseIntentId(data, resolved.pattern)),
                normalized: data,
            };
        }
    }

    return {
        route: 'legacy_action',
        intentId: parseIntentId(data, null),
        critical: isCriticalIntent(parseIntentId(data, null)),
        normalized: data,
    };
}

function parseDeepLinkPayload(payload) {
    const p = String(payload || '').trim();
    if (!p) return { kind: 'empty', payload: p };
    if (/^ref_/i.test(p)) return { kind: 'affiliate', payload: p, ref: p.slice(4) };
    if (/^buy_/i.test(p)) return { kind: 'buy', payload: p, productId: p.slice(4) };
    if (/^produto_/i.test(p)) return { kind: 'product', payload: p, productId: p.slice(8) };
    if (/^loja_/i.test(p)) return { kind: 'shop', payload: p };
    return { kind: 'custom', payload: p };
}

/**
 * Resolve intent unificado para telemetria / ctx.hanorkIntent (B2 gateway).
 * @param {import('telegraf').Context} ctx
 * @param {object} [registry]
 * @returns {object|null}
 */
function resolve(ctx, registry = null) {
    if (ctx.callbackQuery?.data) {
        const pred = predictCallbackRoute(ctx.callbackQuery.data, registry);
        const parts = pred.intentId.split(':');
        return {
            id: pred.intentId,
            source: 'callback',
            raw: ctx.callbackQuery.data,
            params: {},
            namespace: parts[0] || 'unknown',
            action: parts[1] || '',
            critical: pred.critical,
            route: pred.route,
            normalized: pred.normalized,
        };
    }

    const text = ctx.message?.text?.trim();
    if (!text) return null;

    if (text.startsWith('/start')) {
        const payload = text.slice(6).trim().split(/\s+/)[0] || '';
        const dl = parseDeepLinkPayload(payload);
        return {
            id: `deep_link:${dl.kind}`,
            source: 'deep_link',
            raw: payload,
            params: dl,
            namespace: 'start',
            action: dl.kind,
            critical: dl.kind === 'buy' || dl.kind === 'product',
        };
    }

    if (text.startsWith('/')) {
        const cmd = text.slice(1).split(/\s+/)[0]?.split('@')[0]?.toLowerCase() || '';
        return {
            id: `slash:${cmd}`,
            source: 'slash',
            raw: text,
            params: { args: text.slice(cmd.length + 2).trim() },
            namespace: 'slash',
            action: cmd,
            critical: false,
        };
    }

    return {
        id: 'text:free',
        source: 'text',
        raw: text.slice(0, 120),
        params: {},
        namespace: 'text',
        action: 'message',
        critical: false,
    };
}

module.exports = {
    predictCallbackRoute,
    parseIntentId,
    isCriticalIntent,
    parseDeepLinkPayload,
    resolve,
    CRITICAL_NAMESPACES,
};
