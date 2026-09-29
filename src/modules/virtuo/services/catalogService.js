'use strict';

const VirtuoServiceRepository = require('../repositories/virtuoServiceRepository');
const VirtuoApiClient = require('../providers/virtuoApiClient');
const VirtuoConfig = require('../virtuoConfig');
const { FEATURED_SERVICES } = require('../constants/featuredServices');
const { parseVirtuoQuery } = require('../utils/virtuoQueryParser');
const { computeSalePrice, normalizeCostFromApi, isViableForSale } = require('./pricingService');
const {
    reconcileAllFeaturedStock,
    seedBlocksFromFailedOrders,
    activateFromPrices,
} = require('./virtuoStockService');
const { extractApiCountryId, extractCountryName } = require('../utils/virtuoCountryResolver');
const logger = require('../../../config/logger');

function upsertPriceRow({ featured, serviceName, row, server, activeKeys, fromPrices = false }) {
    const countryId = extractApiCountryId(row, { fromPrices });
    const available = Number(row.available ?? 0);
    const cost = normalizeCostFromApi(row.price ?? row.rate);
    if (!countryId || !cost || available <= 0) return 0;
    const sale = computeSalePrice(cost);
    if (!isViableForSale(sale)) return 0;
    const key = `${featured.code}:${countryId}:${server}`;
    activeKeys.push(key);
    VirtuoServiceRepository.upsert({
        service_code: featured.code,
        service_name: serviceName || featured.name,
        country_id: countryId,
        country_name: extractCountryName(row) || String(countryId),
        cost_price: cost,
        sale_price: sale,
        available,
        server,
        active: activateFromPrices(featured.code, countryId, server, null, available),
    });
    return 1;
}

async function syncFromServicesEndpoint(server, featuredMap, activeKeys) {
    let upserted = 0;
    let page = 1;
    let totalPages = 1;
    let anyOk = false;

    while (page <= totalPages) {
        const resp = await VirtuoApiClient.getServices({ server, page, limit: 100 });
        if (!resp.ok) break;
        anyOk = true;
        const services = resp.data?.services || [];
        const pagination = resp.data?.pagination;
        totalPages = Math.max(1, Number(pagination?.totalPages) || 1);

        for (const svc of services) {
            const code = String(svc.id || svc.service_code || '').toLowerCase();
            const featured = featuredMap.get(code);
            if (!featured) continue;
            const serviceName = svc.name || featured.name;
            for (const row of svc.countries || []) {
                upserted += upsertPriceRow({ featured, serviceName, row, server, activeKeys, fromPrices: false });
            }
        }
        page++;
    }

    return { upserted, anyOk };
}

async function syncFromPricesEndpoint(server, featuredMap, activeKeys) {
    let upserted = 0;
    let anyOk = false;

    for (const featured of FEATURED_SERVICES) {
        const resp = await VirtuoApiClient.getPrices(featured.code, undefined, server);
        if (!resp.ok) continue;
        anyOk = true;
        const serviceName = resp.data?.service?.name || featured.name;
        for (const row of resp.data?.prices || []) {
            upserted += upsertPriceRow({ featured, serviceName, row, server, activeKeys, fromPrices: true });
        }
    }

    return { upserted, anyOk };
}

async function syncCatalogFromApi() {
    if (!VirtuoConfig.apiKey) {
        return { ok: false, error: 'no_api_key' };
    }
    const activeKeys = [];
    const server = VirtuoConfig.defaultServer;
    const featuredMap = new Map(FEATURED_SERVICES.map((f) => [f.code, f]));

    let upserted = 0;
    let source = 'prices';

    const fromPrices = await syncFromPricesEndpoint(server, featuredMap, activeKeys);
    upserted += fromPrices.upserted;

    if (!fromPrices.anyOk || upserted === 0) {
        const fromServices = await syncFromServicesEndpoint(server, featuredMap, activeKeys);
        upserted += fromServices.upserted;
        if (fromServices.anyOk) {
            source = fromPrices.anyOk ? 'prices+services' : 'services';
        }
    } else if (upserted > 0) {
        const fromServices = await syncFromServicesEndpoint(server, featuredMap, activeKeys);
        if (fromServices.anyOk && fromServices.upserted > 0) {
            upserted += fromServices.upserted;
            source = 'prices+services';
        }
    }

    VirtuoServiceRepository.deactivateMissing(activeKeys);

    let stockStats = null;
    try {
        await seedBlocksFromFailedOrders();
        stockStats = await reconcileAllFeaturedStock(FEATURED_SERVICES.map((f) => f.code));
    } catch (e) {
        logger.warn('[Virtuo:sync] estoque live falhou', { detail: e.message });
    }

    logger.info('[Virtuo:sync] catálogo atualizado', {
        upserted,
        activeKeys: activeKeys.length,
        source,
        stock: stockStats,
    });
    return { ok: true, upserted, activeKeys: activeKeys.length, source, stock: stockStats };
}

const VirtuoCatalogService = {
    syncCatalogFromApi,

    listFeaturedApps() {
        const codes = VirtuoServiceRepository.listDistinctServiceCodes();
        const codeSet = new Set(codes.map((c) => c.service_code));
        return FEATURED_SERVICES.filter((f) => codeSet.has(f.code));
    },

    listCountriesForService(serviceCode, page = 0, pageSize = 8) {
        const total = VirtuoServiceRepository.countActiveByServiceCode(serviceCode);
        const countries = VirtuoServiceRepository.listActiveByServiceCodePage(serviceCode, page, pageSize);
        return { countries, total, page, pageSize };
    },

    searchCountriesForService(serviceCode, query, limit = 12) {
        const countries = VirtuoServiceRepository.searchActiveByServiceCodeName(serviceCode, query, limit);
        return { countries, total: countries.length, query };
    },

    searchGlobal(query, limit = 15) {
        const countries = VirtuoServiceRepository.searchActiveGlobal(query, limit);
        return { countries, total: countries.length, query };
    },

    resolveParsedQuery(text) {
        const parsed = parseVirtuoQuery(text);
        if (parsed.serviceCode && parsed.countryQuery) {
            return {
                mode: 'service_country',
                serviceCode: parsed.serviceCode,
                countries: VirtuoServiceRepository.searchActiveByServiceCodeName(
                    parsed.serviceCode,
                    parsed.countryQuery,
                    15
                ),
                parsed,
            };
        }
        if (parsed.serviceCode && !parsed.countryQuery) {
            return { mode: 'service_only', serviceCode: parsed.serviceCode, parsed };
        }
        const q = parsed.countryQuery || parsed.raw;
        return {
            mode: 'global',
            countries: VirtuoServiceRepository.searchActiveGlobal(q, 15),
            parsed,
        };
    },

    getService(id) {
        const row = VirtuoServiceRepository.findById(id);
        if (!row || !row.active) return null;
        return row;
    },

    quote(serviceId) {
        const svc = VirtuoCatalogService.getService(serviceId);
        if (!svc) return { error: 'service_unavailable' };
        if (Number(svc.available) <= 0) return { error: 'out_of_stock' };
        return {
            service: svc,
            cost_total: Number(svc.cost_price),
            sale_total: Number(svc.sale_price),
        };
    },

    countActive() {
        return VirtuoServiceRepository.countActive();
    },
};

module.exports = VirtuoCatalogService;
