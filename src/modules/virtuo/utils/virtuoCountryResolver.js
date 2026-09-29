'use strict';

/**
 * Virtuo API — mapeamento de país.
 *
 * IMPORTANTE (doc empírica /v1):
 * - POST /activation/request body.country = countryId numérico da API (campo countryId em /prices)
 * - virtuo_services.id (SQLite) é ID interno Hanork — NUNCA enviar como country
 * - /services countries[].id === countryId quando presente
 * - /countries retorna só nomes (strings) — não usar para IDs
 */

const VirtuoApiClient = require('../providers/virtuoApiClient');
const logger = require('../../../config/logger');

const priceCache = new Map();
const CACHE_MS = 3 * 60 * 1000;

function normName(s) {
    return String(s || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function cacheKey(serviceCode, server) {
    return `${String(serviceCode).toLowerCase()}:${Number(server) || 1}`;
}

function parseApiCountryId(row) {
    if (!row || typeof row !== 'object') return null;
    const raw = row.countryId ?? row.country_id ?? null;
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** Extrai countryId da API a partir de linha /prices (preferido) ou /services. */
function extractApiCountryId(row, { fromPrices = false } = {}) {
    const fromCountryId = parseApiCountryId(row);
    if (fromCountryId) return fromCountryId;
    if (fromPrices) return null;
    const fallbackId = Number(row?.id);
    if (Number.isFinite(fallbackId) && fallbackId > 0) return fallbackId;
    return null;
}

function extractCountryName(row) {
    return String(row?.countryName ?? row?.name ?? row?.country_name ?? '').trim();
}

async function fetchPriceList(serviceCode, server = 1) {
    const key = cacheKey(serviceCode, server);
    const cached = priceCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;

    const resp = await VirtuoApiClient.getPrices(serviceCode, undefined, server);
    if (!resp.ok) {
        return { ok: false, error: resp.error, prices: [] };
    }
    const prices = resp.data?.prices || [];
    priceCache.set(key, { at: Date.now(), data: { ok: true, prices } });
    return { ok: true, prices };
}

async function resolveApiCountry({ serviceCode, countryName, countryId, catalogRowId, server = 1 }) {
    const list = await fetchPriceList(serviceCode, server);
    if (!list.ok) {
        return { ok: false, error: list.error || { code: 'PRICES_UNAVAILABLE' } };
    }

    const byId = countryId
        ? list.prices.find((p) => Number(p.countryId ?? p.id) === Number(countryId))
        : null;
    const byName = countryName
        ? list.prices.find((p) => normName(p.countryName || p.name) === normName(countryName))
        : null;

    const row = byId || byName;
    if (!row) {
        return {
            ok: false,
            error: {
                code: 'COUNTRY_NOT_FOUND',
                message: `País não encontrado na API: ${countryName || countryId}`,
            },
        };
    }

    const apiCountryId = extractApiCountryId(row, { fromPrices: true });
    const apiCountryName = extractCountryName(row);

    if (!apiCountryId) {
        return { ok: false, error: { code: 'INVALID_COUNTRY_ID', message: 'countryId ausente na API' } };
    }

    // Só erro quando country_id gravado = PK interno (id) mas ≠ countryId real da API.
    // Coincidência id=1 + apiCountryId=1 (Ukraine) é válida — não bloquear.
    if (
        catalogRowId != null &&
        countryId != null &&
        Number(countryId) === Number(catalogRowId) &&
        Number(countryId) !== Number(apiCountryId)
    ) {
        logger.error('[Virtuo:country] country_id igual ao id interno do catálogo', {
            catalogRowId,
            countryId,
            apiCountryId,
            countryName,
        });
        return {
            ok: false,
            error: {
                code: 'CATALOG_ID_MISMATCH',
                message: 'country_id interno não pode ser usado como country na API',
            },
        };
    }

    if (countryId && Number(countryId) !== apiCountryId) {
        logger.warn('[Virtuo:country] country_id corrigido via /prices', {
            stored: countryId,
            resolved: apiCountryId,
            name: apiCountryName,
            serviceCode,
        });
    }

    if (countryName && normName(countryName) !== normName(apiCountryName)) {
        logger.warn('[Virtuo:country] country_name divergente — usando API', {
            stored: countryName,
            api: apiCountryName,
            apiCountryId,
            serviceCode,
        });
    }

    return {
        ok: true,
        apiCountryId,
        apiCountryName,
        price: Number(row.price ?? 0),
        available: Number(row.available ?? 0),
    };
}

async function resolveForCatalogRow(catalogRow) {
    if (!catalogRow) return { ok: false, error: { code: 'NO_ROW' } };
    return resolveApiCountry({
        serviceCode: catalogRow.service_code,
        countryName: catalogRow.country_name,
        countryId: catalogRow.country_id,
        catalogRowId: catalogRow.id,
        server: catalogRow.server || 1,
    });
}

async function resolveForOrder(order) {
    if (!order) return { ok: false, error: { code: 'NO_ORDER' } };
    return resolveApiCountry({
        serviceCode: order.service_code,
        countryName: order.country_name,
        countryId: order.country_id,
        catalogRowId: order.virtuo_service_id,
        server: order.server || 1,
    });
}

function invalidatePriceCache(serviceCode, server = 1) {
    priceCache.delete(cacheKey(serviceCode, server));
}

module.exports = {
    extractApiCountryId,
    extractCountryName,
    parseApiCountryId,
    fetchPriceList,
    resolveApiCountry,
    resolveForCatalogRow,
    resolveForOrder,
    invalidatePriceCache,
    normName,
};
