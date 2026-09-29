'use strict';

require('../../config/env');

function envFlag(name, defaultOn = false) {
    const v = String(process.env[name] ?? '').trim().toLowerCase();
    if (!v) return defaultOn;
    return v === '1' || v === 'true' || v === 'yes';
}

/** Telemetria de rota (registry vs legacy) — padrão ON, só observa, não muda fluxo. */
function isTelemetryEnabled() {
    return envFlag('HANORK_GATEWAY_TELEMETRY', true);
}

/** Log debug quando predição ≠ rota real (não bloqueia). */
function isMismatchLogEnabled() {
    return envFlag('HANORK_GATEWAY_MISMATCH_LOG', false);
}

/** B2 gateway unificado — liga middleware HanorkGateway (dual dispatch + telemetria). */
function isFullGatewayEnabled() {
    return envFlag('HANORK_GATEWAY', false);
}

/** U3 — WARN log quando callback cai em rota legacy (padrão ON com gateway). */
function isLegacyWarnEnabled() {
    if (!isFullGatewayEnabled()) return false;
    return envFlag('HANORK_GATEWAY_LEGACY_WARN', true);
}

module.exports = {
    isTelemetryEnabled,
    isMismatchLogEnabled,
    isFullGatewayEnabled,
    isLegacyWarnEnabled,
};
