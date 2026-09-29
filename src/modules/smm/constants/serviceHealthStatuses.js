'use strict';

const SERVICE_HEALTH = {
    HEALTHY: 'HEALTHY',
    WARNING: 'WARNING',
    DEGRADED: 'DEGRADED',
    DISABLED: 'DISABLED',
};

/** Não usar em fulfill nem catálogo público */
const BLOCKED_FOR_FULFILL = new Set([
    SERVICE_HEALTH.DEGRADED,
    SERVICE_HEALTH.DISABLED,
]);

const BLOCKED_FOR_CATALOG = BLOCKED_FOR_FULFILL;

function normalizeHealth(value) {
    const v = String(value || SERVICE_HEALTH.HEALTHY).toUpperCase();
    return Object.values(SERVICE_HEALTH).includes(v) ? v : SERVICE_HEALTH.HEALTHY;
}

function isFulfillHealth(service) {
    if (!service?.active) return false;
    return !BLOCKED_FOR_FULFILL.has(normalizeHealth(service.service_health));
}

function isCatalogHealth(service) {
    if (!service?.active) return false;
    return !BLOCKED_FOR_CATALOG.has(normalizeHealth(service.service_health));
}

module.exports = {
    SERVICE_HEALTH,
    BLOCKED_FOR_FULFILL,
    BLOCKED_FOR_CATALOG,
    normalizeHealth,
    isFulfillHealth,
    isCatalogHealth,
};
