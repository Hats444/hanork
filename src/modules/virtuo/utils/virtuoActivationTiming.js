'use strict';

const VirtuoConfig = require('../virtuoConfig');

function parseTs(value) {
    const t = Date.parse(value || '');
    return Number.isFinite(t) ? t : null;
}

/** Epoch ms quando a ativação começou na Virtuo (compra do número). */
function activationSinceMs(order, apiStatus = null) {
    const fromApi = parseTs(apiStatus?.createdAt);
    if (fromApi) return fromApi;
    const assigned = parseTs(order?.phone_assigned_at);
    if (assigned) return assigned;
    return parseTs(order?.created_at);
}

function activationElapsedMs(order, apiStatus = null) {
    const since = activationSinceMs(order, apiStatus);
    if (!since) return 0;
    return Date.now() - since;
}

/** Doc Virtuo: cancelar entre 2 e 30 min — disparamos antes do limite. */
function isActivationExpired(order, apiStatus = null) {
    return activationElapsedMs(order, apiStatus) >= VirtuoConfig.activationCancelAtMs;
}

function msUntilUserCanCancel(order, apiStatus = null) {
    const since = activationSinceMs(order, apiStatus);
    if (!since) return VirtuoConfig.userCancelMinMs;
    return Math.max(0, VirtuoConfig.userCancelMinMs - (Date.now() - since));
}

module.exports = {
    activationSinceMs,
    activationElapsedMs,
    isActivationExpired,
    msUntilUserCanCancel,
};
