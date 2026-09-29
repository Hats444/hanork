'use strict';

const VirtuoApiClient = require('../providers/virtuoApiClient');
const VirtuoConfig = require('../virtuoConfig');
const { FEATURED_SERVICES, featuredByCode } = require('../constants/featuredServices');
const { extractApiCountryId, extractCountryName, normName } = require('../utils/virtuoCountryResolver');
const { computeSalePrice, normalizeCostFromApi, isViableForSale } = require('./pricingService');
const VirtuoServiceAvailability = require('./virtuoServiceAvailability');
const { isBlocked } = require('./virtuoCountryBlockCache');
const logger = require('../../../config/logger');

function offerKey(serviceCode, countryId, server) {
    return `${String(serviceCode).toLowerCase()}:${Number(countryId)}:${Number(server) || 1}`;
}

function mapPriceRow(row, serviceCode, serviceName, server) {
    const countryId = extractApiCountryId(row, { fromPrices: true });
    const available = Number(row.available ?? 0);
    const cost = normalizeCostFromApi(row.price ?? row.rate);
    if (!countryId || !cost || available <= 0) return null;
    const sale = computeSalePrice(cost);
    if (!isViableForSale(sale)) return null;
    const countryName = extractCountryName(row) || String(countryId);
    return {
        key: offerKey(serviceCode, countryId, server),
        service_code: String(serviceCode).toLowerCase(),
        service_name: serviceName,
        country_id: countryId,
        country_name: countryName,
        cost_price: cost,
        sale_price: sale,
        available,
        server: Number(server) || VirtuoConfig.defaultServer,
    };
}

async function fetchAllPriceRows(serviceCode, server = VirtuoConfig.defaultServer) {
    // Garantir que serviceCode é válido antes de chamar a API
    const code = String(serviceCode || '').trim().toLowerCase();
    if (!code) {
        return { ok: false, error: { code: 'INVALID_PARAMS', message: 'serviceCode vazio' }, rows: [] };
    }

    const resp = await VirtuoApiClient.fetchPricesList(code, server);
    if (!resp.ok) {
        if (resp.error?.code === 'NOT_FOUND' || resp.httpStatus === 404) {
            const svc = await VirtuoApiClient.findServiceByCode(code, server);
            if (!svc.ok) {
                VirtuoServiceAvailability.handleServiceError(code, resp.error);
            }
        }
        return { ok: false, error: resp.error, rows: [] };
    }
    const serviceName = resp.data?.service?.name || featuredByCode(code)?.name || code;
    const rows = (resp.data?.prices || [])
        .map((r) => mapPriceRow(r, code, serviceName, server))
        .filter((r) => r && !isBlocked(code, r.country_id, r.server))
        .sort((a, b) => a.country_name.localeCompare(b.country_name, 'pt-BR'));
    return { ok: true, rows, serviceName };
}

async function fetchOffersForService(serviceCode, server = VirtuoConfig.defaultServer) {
    // Conforme documentação oficial: sem fallback de servidor
    // Consulta apenas o servidor especificado
    const batch = await fetchAllPriceRows(serviceCode, server);
    if (!batch.ok) {
        return batch;
    }
    return { ok: true, rows: batch.rows };
}

async function getLiveOffer(serviceCode, countryId, server = VirtuoConfig.defaultServer) {
    const code = String(serviceCode || '').toLowerCase();
    const cid = Number(countryId);
    const srv = Number(server) || VirtuoConfig.defaultServer;

    if (!code || !Number.isFinite(cid) || cid <= 0) {
        return { ok: false, error: { code: 'INVALID_PARAMS', message: 'service/country inválidos' } };
    }

    // Lista completa (sem filtro country) — evita 404 espúrio da API em /prices?country=X
    const batch = await fetchAllPriceRows(code, srv);
    if (!batch.ok) {
        return { ok: false, error: batch.error };
    }

    if (isBlocked(code, cid, srv)) {
        return {
            ok: false,
            error: { code: 'NO_NUMBERS', message: 'Sem números disponíveis agora' },
        };
    }

    const offer = batch.rows.find((r) => Number(r.country_id) === cid);
    if (!offer) {
        return {
            ok: false,
            error: { code: 'NOT_FOUND', message: `País ${countryId} não disponível na API para ${code}` },
        };
    }

    return { ok: true, offer };
}

function paginate(rows, page = 0, pageSize = 8) {
    const total = rows.length;
    const safePage = Math.max(0, Number(page) || 0);
    const size = Math.max(1, Number(pageSize) || 8);
    const start = safePage * size;
    return {
        countries: rows.slice(start, start + size),
        total,
        page: safePage,
        pageSize: size,
    };
}

function filterByName(rows, query, limit = 15) {
    const q = normName(query);
    if (!q) return rows.slice(0, limit);
    return rows.filter((r) => normName(r.country_name).includes(q)).slice(0, limit);
}

const VirtuoLiveCatalogService = {
    async listFeaturedApps() {
        return await VirtuoServiceAvailability.getAvailableServices();
    },

    async listCountriesForService(serviceCode, page = 0, pageSize = VirtuoConfig.catalogPageSize) {
        const batch = await fetchOffersForService(serviceCode);
        if (!batch.ok) return { countries: [], total: 0, page: 0, pageSize, error: batch.error };
        return paginate(batch.rows, page, pageSize);
    },

    async searchCountriesForService(serviceCode, query, limit = 12) {
        const batch = await fetchOffersForService(serviceCode);
        if (!batch.ok) return { countries: [], total: 0, query, error: batch.error };
        const countries = filterByName(batch.rows, query, limit);
        return { countries, total: countries.length, query };
    },

    async searchGlobal(query, limit = 15) {
        const q = String(query || '').trim();
        const out = [];
        const featured = await VirtuoServiceAvailability.getAvailableServices();
        for (const app of featured) {
            const batch = await fetchOffersForService(app.code);
            if (!batch.ok) continue;
            out.push(...filterByName(batch.rows, q, limit));
            if (out.length >= limit) break;
        }
        return { countries: out.slice(0, limit), total: Math.min(out.length, limit), query: q };
    },

    async resolveParsedQuery(text) {
        const { parseVirtuoQuery } = require('../utils/virtuoQueryParser');
        const parsed = parseVirtuoQuery(text);
        if (parsed.serviceCode && parsed.countryQuery) {
            return {
                mode: 'service_country',
                serviceCode: parsed.serviceCode,
                ...(await VirtuoLiveCatalogService.searchCountriesForService(
                    parsed.serviceCode,
                    parsed.countryQuery,
                    15
                )),
                parsed,
            };
        }
        if (parsed.serviceCode && !parsed.countryQuery) {
            return { mode: 'service_only', serviceCode: parsed.serviceCode, parsed };
        }
        const q = parsed.countryQuery || parsed.raw;
        return {
            mode: 'global',
            ...(await VirtuoLiveCatalogService.searchGlobal(q, 15)),
            parsed,
        };
    },

    getLiveOffer,

    async quoteLive(serviceCode, countryId, server) {
        const live = await getLiveOffer(serviceCode, countryId, server);
        if (!live.ok) return { error: live.error?.code || 'service_unavailable' };
        const svc = live.offer;
        if (Number(svc.available) <= 0) return { error: 'out_of_stock' };
        return {
            service: svc,
            cost_total: Number(svc.cost_price),
            sale_total: Number(svc.sale_price),
        };
    },

    /** Compat legado: id numérico SQLite — re-fetch live se possível */
    async quoteLegacyServiceId(serviceId) {
        const VirtuoServiceRepository = require('../repositories/virtuoServiceRepository');
        const row = VirtuoServiceRepository.findById(Number(serviceId));
        if (!row) return { error: 'service_unavailable' };
        return VirtuoLiveCatalogService.quoteLive(row.service_code, row.country_id, row.server);
    },

    offerKey,
};

module.exports = VirtuoLiveCatalogService;
