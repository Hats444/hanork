'use strict';

/**
 * B2 U3 — avisos de depreciação para rotas legacy (sem remover patterns ainda).
 * Gate para remoção: legacyRate < 1% com amostra mínima (ver isLegacyOffReady).
 */
const logger = require('../../config/logger');
const { isLegacyWarnEnabled, isFullGatewayEnabled } = require('./config');
const routeTelemetry = require('./routeTelemetry');

const WARN_THROTTLE_MS = Number(process.env.HANORK_GATEWAY_LEGACY_WARN_MS) || 5 * 60 * 1000;
const SUMMARY_INTERVAL_MS = Number(process.env.HANORK_GATEWAY_SUMMARY_MS) || 60 * 60 * 1000;
const LEGACY_OFF_MIN_SAMPLES = Number(process.env.HANORK_GATEWAY_LEGACY_OFF_MIN) || 200;
const LEGACY_OFF_MAX_RATE = 0.01;

const _lastWarnByFamily = new Map();
let _lastSummaryAt = 0;

function classifyLegacyFamily(raw) {
    const s = String(raw || '');
    if (/^payment:/.test(s) || /^pp_|^pc_|^check_|^copypix_|^cancel_|^payment_methods_/.test(s)) {
        return 'payment';
    }
    if (/^a_|^bcast_|^adm_/.test(s)) return 'admin';
    if (/^prod_/.test(s)) return 'product_wizard';
    if (/^wa_|^gw_/.test(s)) return 'whatsapp';
    if (/^fs_|^view_giveaway_/.test(s)) return 'flash';
    if (/^cat_|^add_\d+|^buy_\d+|^p_\d+/.test(s)) return 'catalog_legacy';
    return 'other';
}

function isLegacyOffReady() {
    const stats = routeTelemetry.getStats();
    return stats.total >= LEGACY_OFF_MIN_SAMPLES && stats.legacyRate < LEGACY_OFF_MAX_RATE;
}

function warnLegacyRoute(route, rawData) {
    if (!isLegacyWarnEnabled()) return;

    const family = classifyLegacyFamily(rawData);
    const now = Date.now();
    const last = _lastWarnByFamily.get(family) || 0;
    if (now - last < WARN_THROTTLE_MS) return;
    _lastWarnByFamily.set(family, now);

    logger.warn('[HanorkGateway] U3 legacy route (scheduled for removal)', {
        route,
        family,
        data: String(rawData || '').slice(0, 48),
        legacyOffReady: isLegacyOffReady(),
    });
}

function maybeLogPeriodicSummary() {
    if (!isFullGatewayEnabled() || !isLegacyWarnEnabled()) return;

    const now = Date.now();
    if (now - _lastSummaryAt < SUMMARY_INTERVAL_MS) return;

    const stats = routeTelemetry.getStats();
    if (stats.total < 10) return;

    _lastSummaryAt = now;
    logger.info('[HanorkGateway] U3 telemetry summary', {
        total: stats.total,
        registryRate: Math.round(stats.registryRate * 1000) / 10,
        legacyRate: Math.round(stats.legacyRate * 1000) / 10,
        legacyOffReady: isLegacyOffReady(),
        breakdown: {
            registry: stats.registry,
            legacy: stats.legacy,
            legacy_payment: stats.legacy_payment,
            legacy_action: stats.legacy_action,
        },
    });
}

function resetDeprecationState() {
    _lastWarnByFamily.clear();
    _lastSummaryAt = 0;
}

module.exports = {
    classifyLegacyFamily,
    isLegacyOffReady,
    warnLegacyRoute,
    maybeLogPeriodicSummary,
    resetDeprecationState,
    LEGACY_OFF_MIN_SAMPLES,
    LEGACY_OFF_MAX_RATE,
};
