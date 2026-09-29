'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../../../config/logger');
const SmmConfig = require('../smmConfig');
const { classifyService } = require('./classificationService');
const { deriveServiceFamily, computeStaticServiceScore } = require('./familyService');
const { computeSalePrice } = require('./pricingService');
const SmmServiceRepository = require('../repositories/smmServiceRepository');
const SmmPriceHistoryRepository = require('../repositories/smmPriceHistoryRepository');
const SmmSyncHistoryRepository = require('../repositories/smmSyncHistoryRepository');
const { getProvider } = require('../providers/providerRegistry');
const ProviderManager = require('../providers/ProviderManager');
const CacheService = require('./cacheService');
const { isCatalogServiceType } = require('../constants/serviceTypes');

function serviceNamePrefix(providerName) {
    if (!ProviderManager.isDualProviderEnabled() || !SmmConfig.dualCatalogMerge) return '';
    if (providerName === ProviderManager.SECONDARY_ID) return '[UP] ';
    return '[SSM] ';
}

function normalizeRawService(raw, providerName = SmmConfig.defaultProvider) {
    const providerServiceId = Number(raw.service ?? raw.provider_service_id);
    if (!Number.isFinite(providerServiceId)) return null;

    const costPrice = Number(raw.rate);
    if (!Number.isFinite(costPrice) || costPrice < 0) return null;

    const serviceType = String(raw.type || 'Default').trim() || 'Default';
    const classified = classifyService(raw);
    const salePrice = computeSalePrice(costPrice);

    const rawName = String(raw.name || '').trim() || `Serviço ${providerServiceId}`;
    const displayName = `${serviceNamePrefix(providerName)}${rawName}`;

    const serviceFamily = deriveServiceFamily({
        platform: classified.platform,
        subcategory: classified.subcategory,
        name: rawName,
    });

    const baseRow = {
        provider: providerName,
        provider_service_id: providerServiceId,
        platform: classified.platform,
        subcategory: classified.subcategory,
        name: displayName,
        description: '',
        service_type: serviceType,
        category_raw: classified.category_raw,
        cost_price: costPrice,
        sale_price: salePrice,
        min_quantity: Math.max(1, Number(raw.min) || 1),
        max_quantity: Math.max(1, Number(raw.max) || 1000000),
        refill: !!raw.refill,
        cancel: !!raw.cancel,
        dripfeed: !!raw.dripfeed,
        active: isCatalogServiceType(serviceType),
        service_family: serviceFamily,
    };

    return {
        ...baseRow,
        service_score: computeStaticServiceScore(baseRow),
    };
}

function loadJsonCatalog(filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`Catálogo JSON não encontrado: ${resolved}`);
    }
    const data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    if (!Array.isArray(data)) {
        throw new Error('all-services.json deve ser um array');
    }
    return data;
}

async function fetchApiCatalog() {
    const provider = getProvider(SmmConfig.defaultProvider);
    if (!provider) throw new Error('Provider SMM não registrado');
    const services = await provider.getServices();
    if (!Array.isArray(services)) {
        throw new Error('API não retornou lista de serviços');
    }
    return services;
}

async function resolveCatalogSource(preferred) {
    if (preferred === 'json') {
        return { source: 'json', items: loadJsonCatalog(SmmConfig.catalogJsonPath) };
    }
    if (preferred === 'api') {
        return { source: 'api', items: await fetchApiCatalog() };
    }
    if (SmmConfig.providerKey) {
        try {
            const items = await fetchApiCatalog();
            return { source: 'api', items };
        } catch (e) {
            logger.warn('[SMM:sync] API falhou, fallback JSON', { detail: e.message });
        }
    }
    return { source: 'json', items: loadJsonCatalog(SmmConfig.catalogJsonPath) };
}

async function syncProviderCatalog(providerName, options = {}) {
    const provider = getProvider(providerName);
    if (!provider?.getServices) return { processed: 0, created: 0, updated: 0, removed: 0 };
    if (!ProviderManager.isProviderConfigured(providerName)) {
        return { processed: 0, created: 0, updated: 0, removed: 0, skipped: true };
    }

    const services = await provider.getServices();
    if (!Array.isArray(services)) {
        throw new Error(`API ${providerName} não retornou lista de serviços`);
    }

    const activeIds = [];
    let created = 0;
    let updated = 0;
    let processed = 0;

    for (const raw of services) {
        const row = normalizeRawService(raw, providerName);
        if (!row) continue;
        processed++;
        const result = SmmServiceRepository.upsert(row);
        if (result.created) created++;
        else {
            updated++;
            if (result.oldCost != null && result.oldCost !== row.cost_price) {
                SmmPriceHistoryRepository.record(result.id, result.oldCost, row.cost_price);
            }
        }
        activeIds.push(row.provider_service_id);
    }

    let removed = 0;
    if (options.deactivateMissing !== false) {
        removed = SmmServiceRepository.deactivateMissing(providerName, activeIds);
    }

    await ProviderManager.refreshServicesCache(providerName);
    return { processed, created, updated, removed, activeIds };
}

async function syncCatalog(options = {}) {
    const syncId = SmmSyncHistoryRepository.start(options.syncType || 'full');
    const stats = {
        total_processed: 0,
        created_count: 0,
        updated_count: 0,
        removed_count: 0,
        balance_snapshot: null,
        error_message: null,
    };

    try {
        const { source, items } = await resolveCatalogSource(options.source || 'auto');
        const provider = getProvider(SmmConfig.defaultProvider);
        if (provider && SmmConfig.providerKey) {
            try {
                const bal = await provider.getBalance();
                if (bal && !bal.error) {
                    stats.balance_snapshot = JSON.stringify(bal);
                }
            } catch (_) { /* opcional */ }
        }

        const activeIds = [];
        for (const raw of items) {
            const row = normalizeRawService(raw, SmmConfig.defaultProvider);
            if (!row) continue;
            stats.total_processed++;

            const result = SmmServiceRepository.upsert(row);
            if (result.created) {
                stats.created_count++;
            } else {
                stats.updated_count++;
                if (result.oldCost != null && result.oldCost !== row.cost_price) {
                    SmmPriceHistoryRepository.record(result.id, result.oldCost, row.cost_price);
                }
            }
            activeIds.push(row.provider_service_id);
        }

        if (options.deactivateMissing !== false) {
            stats.removed_count = SmmServiceRepository.deactivateMissing(
                SmmConfig.defaultProvider,
                activeIds
            );
        }

        if (ProviderManager.isDualProviderEnabled() && SmmConfig.dualCatalogMerge) {
            try {
                const secondary = await syncProviderCatalog(ProviderManager.SECONDARY_ID, options);
                stats.total_processed += secondary.processed || 0;
                stats.created_count += secondary.created || 0;
                stats.updated_count += secondary.updated || 0;
                stats.secondary_removed = secondary.removed || 0;
            } catch (e) {
                logger.warn('[SMM:sync] catálogo secundário falhou', { detail: e.message });
                stats.secondary_error = e.message;
            }
        } else {
            await ProviderManager.refreshServicesCache(ProviderManager.PRIMARY_ID);
        }

        const familyStats = SmmServiceRepository.refreshFamilyScores();
        stats.families_active = familyStats.families;
        stats.family_scores_updated = familyStats.updated;

        await CacheService.invalidateAll();
        SmmSyncHistoryRepository.finish(syncId, stats);
        logger.info('[SMM:sync] Concluído', { source, ...stats });
        return { ok: true, source, ...stats };
    } catch (e) {
        stats.error_message = e.message;
        SmmSyncHistoryRepository.finish(syncId, stats);
        logger.error('[SMM:sync] Falhou', { detail: e.message });
        return { ok: false, error: e.message, ...stats };
    }
}

module.exports = {
    normalizeRawService,
    loadJsonCatalog,
    syncProviderCatalog,
    syncCatalog,
};
