'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../../../config/logger');
const SmmConfig = require('../smmConfig');
const { getProvider } = require('./providerRegistry');
const SsmProviderAdapter = require('./ssmProviderAdapter');
const UpFamaProvider = require('./upFamaProvider');
const SmmServiceRepository = require('../repositories/smmServiceRepository');
const { computeOrderCost } = require('../services/pricingService');
const { isFulfillHealth } = require('../constants/serviceHealthStatuses');

const PRIMARY_ID = SsmProviderAdapter.name;
const SECONDARY_ID = UpFamaProvider.name;

const MODES = Object.freeze({
    AUTO: 'auto',
    SSM: 'ssm',
    UP: 'up',
});

let adminModeOverride = null;

const servicesCache = {
    [PRIMARY_ID]: { at: 0, items: [] },
    [SECONDARY_ID]: { at: 0, items: [] },
};

function maskKey(key) {
    if (!key || key.length < 8) return '(empty)';
    return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function isProviderConfigured(providerId) {
    if (providerId === PRIMARY_ID) return !!SmmConfig.providerKey;
    if (providerId === SECONDARY_ID) return !!SmmConfig.upFamaApiKey;
    return false;
}

function isDualProviderEnabled() {
    return isProviderConfigured(SECONDARY_ID) && SmmConfig.dualProviderEnabled;
}

function getAdminMode() {
    return adminModeOverride;
}

function setAdminMode(mode) {
    const normalized = String(mode || '').toLowerCase();
    if (!normalized || normalized === MODES.AUTO) {
        adminModeOverride = null;
        return MODES.AUTO;
    }
    if (normalized === MODES.SSM || normalized === 'fornecedorbrasil') {
        adminModeOverride = MODES.SSM;
        return MODES.SSM;
    }
    if (normalized === MODES.UP || normalized === SECONDARY_ID) {
        adminModeOverride = MODES.UP;
        return MODES.UP;
    }
    return null;
}

function getEffectiveMode() {
    const override = adminModeOverride || SmmConfig.providerMode;
    if (override === MODES.SSM || override === MODES.UP) return override;
    return MODES.AUTO;
}

function getProviderChain() {
    const mode = getEffectiveMode();
    if (mode === MODES.SSM) return [PRIMARY_ID];
    if (mode === MODES.UP) return [SECONDARY_ID];
    const chain = [PRIMARY_ID];
    if (isProviderConfigured(SECONDARY_ID)) chain.push(SECONDARY_ID);
    return chain;
}

function loadServiceMapping() {
    if (testMappingOverride) return testMappingOverride;
    const filePath = SmmConfig.serviceMappingPath;
    try {
        if (!fs.existsSync(filePath)) return { mappings: [] };
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
            mappings: Array.isArray(parsed?.mappings) ? parsed.mappings : [],
        };
    } catch (e) {
        logger.warn('[SMM:ProviderManager] serviceMapping inválido', { detail: e.message });
        return { mappings: [] };
    }
}

function mapSsmToUpServiceId(ssmProviderServiceId) {
    const id = Number(ssmProviderServiceId);
    const hit = loadServiceMapping().mappings.find((m) => Number(m.ssmServiceId) === id);
    return hit?.upServiceId != null ? Number(hit.upServiceId) : null;
}

function mapUpToSsmServiceId(upProviderServiceId) {
    const id = Number(upProviderServiceId);
    const hit = loadServiceMapping().mappings.find((m) => Number(m.upServiceId) === id);
    return hit?.ssmServiceId != null ? Number(hit.ssmServiceId) : null;
}

let testProviderResolver = null;
let testMappingOverride = null;

function resolveProvider(providerId) {
    if (testProviderResolver) return testProviderResolver(providerId);
    return getProvider(providerId);
}

function extractProviderOrderId(raw) {
    if (!raw || raw.error) return null;
    return raw.order ?? raw.order_id ?? raw.id ?? null;
}

function extractProviderError(raw) {
    if (!raw) return 'empty_response';
    if (raw.error) return String(raw.message || raw.error).slice(0, 200);
    return null;
}

function isProviderFailure(raw) {
    if (!raw) return true;
    if (raw.error === true) return true;
    if (typeof raw.error === 'string' && raw.error && !['false', '0', 'ok'].includes(raw.error.toLowerCase())) {
        return true;
    }
    return !extractProviderOrderId(raw);
}

async function invokeCreateOrder(provider, serviceId, link, quantity, options = {}) {
    if (typeof provider.addOrder === 'function') {
        return provider.addOrder(serviceId, link, quantity, options);
    }
    return provider.createOrder({ serviceId, link, quantity, ...options });
}

function cacheIsFresh(providerId) {
    const entry = servicesCache[providerId];
    if (!entry?.items?.length) return false;
    return Date.now() - entry.at < SmmConfig.providerServicesCacheTtlMs;
}

async function fetchProviderServices(providerId, force = false) {
    if (!force && cacheIsFresh(providerId)) {
        return servicesCache[providerId].items;
    }
    const provider = resolveProvider(providerId);
    if (!provider?.getServices) return [];
    const raw = await provider.getServices();
    const normalizer = provider.normalizeServices || SsmProviderAdapter.normalizeServices;
    const items = normalizer(Array.isArray(raw) ? raw : []);
    servicesCache[providerId] = { at: Date.now(), items };
    return items;
}

async function refreshServicesCache(providerId = null) {
    const targets = providerId ? [providerId] : [PRIMARY_ID, SECONDARY_ID];
    const out = {};
    for (const id of targets) {
        if (!isProviderConfigured(id)) {
            servicesCache[id] = { at: Date.now(), items: [] };
            out[id] = 0;
            continue;
        }
        const items = await fetchProviderServices(id, true);
        out[id] = items.length;
    }
    return out;
}

async function getMergedServices(force = false) {
    if (!SmmConfig.dualCatalogMerge) {
        const primary = await fetchProviderServices(PRIMARY_ID, force);
        return primary.map((s) => ({
            ...s,
            name: SmmConfig.dualCatalogMerge ? `[${s.origin}] ${s.name}` : s.name,
        }));
    }
    const merged = [];
    for (const providerId of [PRIMARY_ID, SECONDARY_ID]) {
        if (!isProviderConfigured(providerId)) continue;
        const items = await fetchProviderServices(providerId, force);
        for (const item of items) {
            merged.push({
                ...item,
                name: `[${item.origin}] ${item.name}`,
            });
        }
    }
    return merged;
}

function resolveDbServiceForProvider(providerId, providerServiceId) {
    try {
        return SmmServiceRepository.findByProviderId(providerId, Number(providerServiceId));
    } catch (_) {
        return null;
    }
}

function isNativeUpCatalogService(service) {
    const provider = String(service?.provider || '').toLowerCase();
    return provider === SECONDARY_ID || provider === 'upfama';
}

function isNativeSsmCatalogService(service) {
    const provider = String(service?.provider || '').toLowerCase();
    return provider === PRIMARY_ID || provider === 'fornecedorbrasil';
}

function getFulfillProviderChain(orderedService, candidates = []) {
    const base = getProviderChain();
    return base.filter((providerId) => {
        if (!isProviderConfigured(providerId)) return false;
        const attempts = buildFallbackAttempts(providerId, orderedService, candidates);
        return attempts.length > 0;
    });
}

function buildFallbackAttempts(providerId, orderedService, candidates) {
    if (providerId === PRIMARY_ID) {
        return candidates
            .filter((service) => !isNativeUpCatalogService(service))
            .map((service) => ({
                service,
                providerServiceId: service.provider_service_id,
            }));
    }

    const attempts = [];
    const seen = new Set();

    const pushAttempt = (service, providerServiceId, extra = {}) => {
        const id = Number(providerServiceId);
        if (!Number.isFinite(id) || seen.has(id)) return;
        seen.add(id);
        attempts.push({
            service,
            providerServiceId: id,
            ...extra,
        });
    };

    // Catálogo nativo UP (ex.: Passe Free Fire) — usa provider_service_id direto
    for (const service of candidates) {
        if (isNativeUpCatalogService(service)) {
            pushAttempt(service, service.provider_service_id);
        }
    }
    if (attempts.length) {
        return attempts;
    }

    const mappedUpId = mapSsmToUpServiceId(orderedService.provider_service_id);
    if (mappedUpId != null) {
        const mappedSvc = resolveDbServiceForProvider(SECONDARY_ID, mappedUpId);
        pushAttempt(
            mappedSvc || {
                id: null,
                provider: SECONDARY_ID,
                provider_service_id: mappedUpId,
                cost_price: orderedService.cost_price,
                service_type: orderedService.service_type,
                name: orderedService.name,
            },
            mappedUpId,
            { mapped: true }
        );
    }

    const cached = servicesCache[SECONDARY_ID]?.items || [];
    const mappedEntry = loadServiceMapping().mappings.find(
        (m) => Number(m.ssmServiceId) === Number(orderedService.provider_service_id)
    );
    if (mappedEntry?.upServiceId != null) {
        const upId = Number(mappedEntry.upServiceId);
        const cachedRate = cached.find((c) => c.providerServiceId === upId);
        if (cachedRate) {
            pushAttempt(
                resolveDbServiceForProvider(SECONDARY_ID, upId) || {
                    id: null,
                    provider: SECONDARY_ID,
                    provider_service_id: upId,
                    cost_price: cachedRate.rate,
                    service_type: orderedService.service_type,
                    name: cachedRate.name,
                },
                upId,
                { mapped: true }
            );
        }
    }

    return attempts;
}

function getProviderForOrder(smmOrder) {
    const providerId = smmOrder?.provider_used || smmOrder?.provider || PRIMARY_ID;
    return resolveProvider(providerId);
}

function resolveOrderProviderId(smmOrder) {
    return smmOrder?.provider_used || smmOrder?.provider || PRIMARY_ID;
}

async function parseBalance(provider) {
    const raw = await provider.getBalance();
    if (!raw || raw.error === true || (typeof raw.error === 'string' && raw.error)) {
        return { ok: false, error: String(raw?.message || raw?.error || 'balance_unavailable') };
    }
    const balance = Number(raw.balance ?? raw);
    if (!Number.isFinite(balance)) {
        return { ok: false, error: 'balance_invalid', raw };
    }
    return { ok: true, balance, currency: raw.currency || 'BRL', raw };
}

async function assertFulfillAllowed({ candidates, quantity, orderedService = null }) {
    if (!candidates?.length) {
        return { ok: false, reason: 'no_candidates' };
    }
    const healthy = candidates.filter((c) => isFulfillHealth(c));
    if (!healthy.length) {
        return { ok: false, reason: 'no_healthy_candidates' };
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: false, reason: 'invalid_quantity' };
    }

    const orderSvc = orderedService || healthy[0];
    const chain = getFulfillProviderChain(orderSvc, healthy);
    let lastFail = null;

    for (const providerId of chain) {
        const provider = resolveProvider(providerId);
        if (!provider?.getBalance) {
            return { ok: true, providerId, skipped: 'no_balance_api' };
        }

        const attempts = buildFallbackAttempts(providerId, orderSvc, healthy);
        if (!attempts.length) continue;

        const costService = attempts[0].service || orderSvc;
        const requiredCost = computeOrderCost(costService.cost_price, qty, costService.service_type);
        if (!Number.isFinite(requiredCost) || requiredCost <= 0) {
            lastFail = { ok: false, reason: 'invalid_cost' };
            continue;
        }

        try {
            const bal = await parseBalance(provider);
            if (!bal.ok) {
                lastFail = { ok: false, reason: 'balance_check_failed', providerId, detail: bal.error };
                continue;
            }
            if (bal.balance < requiredCost) {
                lastFail = {
                    ok: false,
                    reason: 'insufficient_provider_balance',
                    providerId,
                    balance: bal.balance,
                    required: requiredCost,
                };
                continue;
            }
            return {
                ok: true,
                providerId,
                balance: bal.balance,
                required: requiredCost,
            };
        } catch (e) {
            lastFail = { ok: false, reason: 'balance_check_failed', providerId, detail: e.message };
        }
    }

    return lastFail || { ok: false, reason: 'no_provider' };
}

async function submitOrderWithFallback({ orderedService, candidates, link, quantity, comments = null }) {
    const chain = getFulfillProviderChain(orderedService, candidates);
    let lastRaw = null;
    let lastProviderId = null;

    for (const providerId of chain) {
        const provider = resolveProvider(providerId);
        if (!provider) continue;

        const attempts = buildFallbackAttempts(providerId, orderedService, candidates);
        if (!attempts.length) continue;

        for (let i = 0; i < attempts.length; i++) {
            const attempt = attempts[i];
            const raw = await invokeCreateOrder(
                provider,
                attempt.providerServiceId,
                link,
                quantity,
                comments ? { comments } : {}
            );
            lastRaw = raw;
            lastProviderId = providerId;
            const providerOrderId = extractProviderOrderId(raw);

            if (providerOrderId) {
                return {
                    ok: true,
                    providerOrderId: String(providerOrderId),
                    providerId,
                    usedService: attempt.service,
                    raw,
                    fallback: providerId !== chain[0],
                    attempt: i + 1,
                };
            }

            const errMsg = extractProviderError(raw);
            logger.warn('[SMM:ProviderManager] tentativa falhou', {
                providerId,
                providerServiceId: attempt.providerServiceId,
                attempt: i + 1,
                detail: errMsg,
            });
        }
    }

    return {
        ok: false,
        reason: chain.length > 1 ? 'all_providers_failed' : 'provider_rejected',
        raw: lastRaw,
        providerId: lastProviderId,
    };
}

async function fetchAllBalances() {
    const ids = [PRIMARY_ID, SECONDARY_ID].filter(isProviderConfigured);
    const fetchOne = async (providerId) => {
        const provider = resolveProvider(providerId);
        const label = providerId === PRIMARY_ID ? 'SSM' : 'UP';
        const fingerprint = provider.keyFingerprint?.() || maskKey('');
        const attempt = async () => parseBalance(provider);
        try {
            let bal = await attempt();
            if (!bal.ok && /etimedout|eai_again|enotfound|econnrefused|socket hang up/i.test(String(bal.error))) {
                await new Promise((r) => setTimeout(r, 2500));
                bal = await attempt();
            }
            return {
                providerId,
                label,
                ok: bal.ok,
                balance: bal.balance,
                currency: bal.currency,
                error: bal.error,
                fingerprint,
            };
        } catch (e) {
            return { providerId, label, ok: false, error: e.message, fingerprint };
        }
    };
    return Promise.all(ids.map(fetchOne));
}

function pickCheapestMappedProvider(ssmProviderServiceId) {
    const mapping = loadServiceMapping().mappings.find(
        (m) => Number(m.ssmServiceId) === Number(ssmProviderServiceId)
    );
    if (!mapping) return PRIMARY_ID;

    const ssmCached = servicesCache[PRIMARY_ID]?.items?.find(
        (s) => s.providerServiceId === Number(mapping.ssmServiceId)
    );
    const upCached = servicesCache[SECONDARY_ID]?.items?.find(
        (s) => s.providerServiceId === Number(mapping.upServiceId)
    );
    const ssmRate = ssmCached?.rate ?? Number.POSITIVE_INFINITY;
    const upRate = upCached?.rate ?? Number.POSITIVE_INFINITY;
    if (upRate < ssmRate && isProviderConfigured(SECONDARY_ID)) return SECONDARY_ID;
    return PRIMARY_ID;
}

const ProviderManager = {
    PRIMARY_ID,
    SECONDARY_ID,
    MODES,
    isDualProviderEnabled,
    isProviderConfigured,
    getAdminMode,
    setAdminMode,
    getEffectiveMode,
    getProviderChain,
    getProviderForOrder,
    resolveOrderProviderId,
    loadServiceMapping,
    mapSsmToUpServiceId,
    mapUpToSsmServiceId,
    fetchProviderServices,
    refreshServicesCache,
    getMergedServices,
    getFulfillProviderChain,
    isNativeUpCatalogService,
    isNativeSsmCatalogService,
    assertFulfillAllowed,
    submitOrderWithFallback,
    fetchAllBalances,
    pickCheapestMappedProvider,
    extractProviderOrderId,
    extractProviderError,
    isProviderFailure,
    maskKey,
    _setTestProviderResolver(fn) {
        testProviderResolver = typeof fn === 'function' ? fn : null;
    },
    _clearTestProviderResolver() {
        testProviderResolver = null;
    },
    _setTestMapping(map) {
        testMappingOverride = map && typeof map === 'object' ? map : null;
    },
    _clearTestMapping() {
        testMappingOverride = null;
    },
};

module.exports = ProviderManager;
