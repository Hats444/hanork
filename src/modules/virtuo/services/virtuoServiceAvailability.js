'use strict';

const VirtuoApiClient = require('../providers/virtuoApiClient');
const VirtuoConfig = require('../virtuoConfig');
const { FEATURED_SERVICES } = require('../constants/featuredServices');
const logger = require('../../../config/logger');

// Cache de serviços indisponíveis: { serviceCode: { timestamp, error } }
const unavailableCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 minutos
const LIST_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutos

let availableListCache = { services: null, timestamp: 0 };
let prefetchInFlight = null;

/**
 * Verifica se um serviço está disponível — GET /services (§16) com fallback /prices.
 */
async function checkServiceAvailability(serviceCode) {
    const code = String(serviceCode || '').toLowerCase();
    if (!code) return false;

    try {
        const svcResp = await VirtuoApiClient.findServiceByCode(code, VirtuoConfig.defaultServer);
        if (svcResp.ok) {
            const countries = svcResp.service?.countries || [];
            return countries.some((c) => Number(c.available) > 0);
        }

        if (svcResp.error?.code === 'NETWORK') {
            return true;
        }

        if (svcResp.error?.code === 'NOT_FOUND' || svcResp.httpStatus === 404) {
            return false;
        }

        const resp = await VirtuoApiClient.fetchPricesList(code, VirtuoConfig.defaultServer);
        if (!resp.ok) {
            if (resp.error?.code === 'NETWORK') {
                return true;
            }
            if (resp.error?.code === 'NOT_FOUND' || resp.httpStatus === 404) {
                return false;
            }
            return true;
        }

        const prices = resp.data?.prices || [];
        return prices.some((p) => Number(p.available) > 0);
    } catch (e) {
        logger.warn('[Virtuo:ServiceAvailability] erro ao verificar serviço', { serviceCode: code, error: e.message });
        return true;
    }
}

function markUnavailable(serviceCode, error = null) {
    const code = String(serviceCode || '').toLowerCase();
    unavailableCache.set(code, {
        timestamp: Date.now(),
        error: error || 'Service not found',
    });
    availableListCache = { services: null, timestamp: 0 };
    logger.warn('[Virtuo:ServiceAvailability] serviço marcado como indisponível', { serviceCode: code, error });
}

function markAvailable(serviceCode) {
    const code = String(serviceCode || '').toLowerCase();
    if (unavailableCache.has(code)) {
        unavailableCache.delete(code);
        availableListCache = { services: null, timestamp: 0 };
        logger.info('[Virtuo:ServiceAvailability] serviço marcado como disponível', { serviceCode: code });
    }
}

function isCachedUnavailable(serviceCode) {
    const code = String(serviceCode || '').toLowerCase();
    const cached = unavailableCache.get(code);

    if (!cached) return false;

    const age = Date.now() - cached.timestamp;
    if (age > CACHE_TTL_MS) {
        unavailableCache.delete(code);
        return false;
    }

    return true;
}

/**
 * Atualiza lista de apps disponíveis consultando a API
 */
async function refreshAvailableServices(force = false) {
    const now = Date.now();
    if (!force && availableListCache.services && now - availableListCache.timestamp < LIST_CACHE_TTL_MS) {
        return availableListCache.services;
    }

    const available = [];

    for (const service of FEATURED_SERVICES) {
        const code = service.code.toLowerCase();

        if (isCachedUnavailable(code)) {
            continue;
        }

        const isAvailable = await checkServiceAvailability(code);
        if (isAvailable) {
            markAvailable(code);
            available.push(service);
        } else {
            markUnavailable(code, 'NOT_FOUND');
        }
    }

    availableListCache = { services: available, timestamp: now };
    return available;
}

async function getAvailableServices() {
    return refreshAvailableServices(false);
}

async function prefetchAvailableServices() {
    if (prefetchInFlight) return prefetchInFlight;
    prefetchInFlight = refreshAvailableServices(true)
        .then((services) => {
            logger.info('[Virtuo:ServiceAvailability] prefetch concluído', {
                total: FEATURED_SERVICES.length,
                available: services.length,
                unavailable: FEATURED_SERVICES.length - services.length,
            });
            return services;
        })
        .catch((e) => {
            logger.warn('[Virtuo:ServiceAvailability] prefetch erro', { detail: e.message });
            return FEATURED_SERVICES.slice();
        })
        .finally(() => {
            prefetchInFlight = null;
        });
    return prefetchInFlight;
}

async function refreshUnavailableServices() {
    const now = Date.now();
    const servicesToCheck = [];

    for (const [code, data] of unavailableCache.entries()) {
        const age = now - data.timestamp;
        if (age >= CHECK_INTERVAL_MS) {
            servicesToCheck.push(code);
        }
    }

    if (servicesToCheck.length === 0) {
        const age = now - availableListCache.timestamp;
        if (!availableListCache.services || age >= LIST_CACHE_TTL_MS) {
            await refreshAvailableServices(true).catch(() => { });
        }
        return;
    }

    logger.info('[Virtuo:ServiceAvailability] verificando serviços indisponíveis', { count: servicesToCheck.length });

    for (const code of servicesToCheck) {
        try {
            const isAvailable = await checkServiceAvailability(code);
            if (isAvailable) {
                markAvailable(code);
            } else {
                const cached = unavailableCache.get(code);
                if (cached) cached.timestamp = Date.now();
            }
        } catch (e) {
            logger.warn('[Virtuo:ServiceAvailability] erro ao re-verificar serviço', { serviceCode: code, error: e.message });
        }
    }

    availableListCache = { services: null, timestamp: 0 };
    await refreshAvailableServices(true).catch(() => { });
}

let refreshInterval = null;

function startAvailabilityChecker() {
    if (refreshInterval) return;

    refreshInterval = setInterval(refreshUnavailableServices, CHECK_INTERVAL_MS);
    logger.info('[Virtuo:ServiceAvailability] verificador iniciado', { intervalMs: CHECK_INTERVAL_MS });
}

function stopAvailabilityChecker() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
        logger.info('[Virtuo:ServiceAvailability] verificador parado');
    }
}

/**
 * Marca serviço indisponível quando a API retorna 404 no nível do serviço (sem país).
 * Não usar para 404 de país específico.
 */
function handleServiceError(serviceCode, error, { countryScoped = false } = {}) {
    if (countryScoped) return;

    const code = String(serviceCode || '').toLowerCase();
    const errorCode = error?.code || error;

    if (errorCode === 'NETWORK' || errorCode === 'TIMEOUT') return;

    if (errorCode === 'NOT_FOUND' || error === 404 || errorCode === 'SERVICE_NOT_FOUND') {
        markUnavailable(code, error);
    }
}

const VirtuoServiceAvailability = {
    checkServiceAvailability,
    getAvailableServices,
    prefetchAvailableServices,
    markUnavailable,
    markAvailable,
    isCachedUnavailable,
    handleServiceError,
    startAvailabilityChecker,
    stopAvailabilityChecker,
    refreshUnavailableServices,
    refreshAvailableServices,
};

module.exports = VirtuoServiceAvailability;
