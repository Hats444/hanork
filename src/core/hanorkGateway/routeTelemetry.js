'use strict';

const logger = require('../../config/logger');
const { isTelemetryEnabled, isMismatchLogEnabled } = require('./config');

const _counts = {
    registry: 0,
    legacy: 0,
    legacy_payment: 0,
    legacy_action: 0,
    unhandled: 0,
    mismatch: 0,
    intent_callback: 0,
    intent_slash: 0,
    intent_text: 0,
    intent_deep_link: 0,
};

const _recent = [];
const RECENT_MAX = 40;

function recordCallbackRoute(actualRoute, rawData, prediction = null) {
    if (!isTelemetryEnabled()) return;

    const key = actualRoute in _counts ? actualRoute : 'unhandled';
    _counts[key] = (_counts[key] || 0) + 1;

    if (prediction && prediction.route !== actualRoute) {
        _counts.mismatch++;
        if (isMismatchLogEnabled()) {
            logger.debug('[HanorkGateway] route mismatch', {
                predicted: prediction.route,
                actual: actualRoute,
                intentId: prediction.intentId,
                data: String(rawData || '').slice(0, 64),
            });
        }
    }

    _recent.push({
        at: Date.now(),
        route: actualRoute,
        intentId: prediction?.intentId || null,
        data: String(rawData || '').slice(0, 48),
    });
    if (_recent.length > RECENT_MAX) _recent.shift();
}

function recordIntentResolve(intent) {
    if (!isTelemetryEnabled() || !intent?.source) return;
    const key = `intent_${intent.source}`;
    if (key in _counts) _counts[key] = (_counts[key] || 0) + 1;
}

function getStats() {
    const { isFullGatewayEnabled, isLegacyWarnEnabled } = require('./config');
    const total =
        _counts.registry +
        _counts.legacy +
        _counts.legacy_payment +
        _counts.legacy_action +
        _counts.unhandled;
    const legacyTotal =
        _counts.legacy + _counts.legacy_payment + _counts.legacy_action;
    const legacyRate = total > 0 ? legacyTotal / total : 0;
    const legacyOffMin = Number(process.env.HANORK_GATEWAY_LEGACY_OFF_MIN) || 200;
    return {
        ..._counts,
        total,
        legacyTotal,
        legacyRate,
        registryRate: total > 0 ? _counts.registry / total : 0,
        mode: isFullGatewayEnabled() ? 'gateway' : 'telemetry',
        legacyWarn: isLegacyWarnEnabled(),
        legacyOffReady: total >= legacyOffMin && legacyRate < 0.01,
        recent: _recent.slice(-10),
    };
}

function resetStats() {
    for (const k of Object.keys(_counts)) _counts[k] = 0;
    _recent.length = 0;
}

module.exports = {
    recordCallbackRoute,
    recordIntentResolve,
    getStats,
    resetStats,
};
