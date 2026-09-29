'use strict';

const axios = require('axios');
const VirtuoConfig = require('../virtuoConfig');
const logger = require('../../../config/logger');

function authHeaders() {
    const key = VirtuoConfig.apiKey;
    return {
        Authorization: `Bearer ${key}`,
        'X-Api-Key': key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
}

function apiPaths() {
    const base = VirtuoConfig.apiUrl.replace(/\/+$/, '');
    return [`${base}/v1`];
}

function isStructuredApiPayload(data) {
    return Boolean(data && typeof data === 'object' && (data.success === false || data.error || data.data));
}

function cleanParams(params) {
    if (!params || typeof params !== 'object') return undefined;
    const out = {};
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
}

async function request(method, path, { params, body, attempt = 0 } = {}) {
    if (!VirtuoConfig.apiKey) {
        return { ok: false, error: { code: 'BAD_KEY', message: 'VIRTUO_API_KEY não configurada' } };
    }
    const paths = apiPaths();
    const route = path.startsWith('/') ? path : `/${path}`;
    const query = cleanParams(params);
    let lastErr = null;

    for (let i = 0; i < paths.length; i++) {
        const url = `${paths[i]}${route}`;
        try {
            const config = {
                method,
                url,
                timeout: VirtuoConfig.apiTimeoutMs,
                headers: authHeaders(),
                validateStatus: () => true,
            };
            if (query) config.params = query;
            if (body) config.data = body;
            const { data, status } = await axios(config);
            if (status >= 400) {
                lastErr = {
                    ok: false,
                    error: data?.error || { code: 'HTTP_ERROR', message: `HTTP ${status}`, status },
                    httpStatus: status,
                };
                // Resposta JSON da API (/v1) — não tentar prefixo alterno (mascara 503 como 404)
                if (isStructuredApiPayload(data)) {
                    return lastErr;
                }
                if (status >= 500 && attempt < 1 && i === paths.length - 1) {
                    await new Promise((r) => setTimeout(r, 1500));
                    return request(method, path, { params, body, attempt: attempt + 1 });
                }
                continue;
            }
            if (data?.success === false) {
                return { ok: false, error: data.error || { code: 'API_ERROR', message: 'Erro API' } };
            }
            return { ok: true, data: data?.data ?? data };
        } catch (e) {
            lastErr = { ok: false, error: { code: 'NETWORK', message: e.message } };
            if (attempt < 1 && i === paths.length - 1) {
                await new Promise((r) => setTimeout(r, 1500));
                return request(method, path, { params, body, attempt: attempt + 1 });
            }
        }
    }
    const detail = lastErr?.error?.message || lastErr?.error?.code || 'unknown';
    logger.warn('[Virtuo:API] request failed', { path, detail, status: lastErr?.httpStatus });
    return lastErr || { ok: false, error: { code: 'UNKNOWN', message: 'Falha na API Virtuo' } };
}

const VirtuoApiClient = {
    async getBalance() {
        return request('GET', '/balance');
    },

    async getServices({ search, server, page = 1, limit = 100 } = {}) {
        return request('GET', '/services', {
            params: { search, server, page, limit },
        });
    },

    async getCountries({ server, page = 1, limit = 100 } = {}) {
        return request('GET', '/countries', { params: { server, page, limit } });
    },

    async getPrices(service, country, server) {
        return request('GET', '/prices', {
            params: { service, country, server },
        });
    },

    /**
     * Ativação — country DEVE ser o countryId da API (/prices), nunca virtuo_services.id.
     * Prefira requestActivationValidated() que resolve via /prices antes de enviar.
     */
    async requestActivation({ service, country, server, maxPrice }) {
        const apiCountry = Number(country);
        if (!Number.isFinite(apiCountry) || apiCountry <= 0) {
            return {
                ok: false,
                error: { code: 'INVALID_COUNTRY', message: 'country inválido para API Virtuo' },
            };
        }
        const body = {
            service: String(service || '').toLowerCase(),
            country: apiCountry,
            server: Number(server) || VirtuoConfig.defaultServer,
        };
        const mp = Number(maxPrice);
        if (Number.isFinite(mp) && mp > 0) body.maxPrice = mp;
        logger.info('[Virtuo:API] activation/request', {
            service: body.service,
            country: body.country,
            server: body.server,
        });
        return request('POST', '/activation/request', { body });
    },

    /** Resolve via catálogo + /prices e chama POST /v1/activation/request. */
    async requestActivationForCatalogRow(catalogRow, { maxPrice, order = null } = {}) {
        const { resolveForActivation, validateActivationResponse } = require('../utils/virtuoActivationResolver');
        const ctx = await resolveForActivation(catalogRow, order);
        if (!ctx.ok) {
            return { ok: false, error: ctx.error };
        }

        const result = await this.requestActivation({
            service: ctx.apiServiceCode,
            country: ctx.apiCountryId,
            server: ctx.server,
            maxPrice,
        });

        if (!result.ok) return result;

        const validation = validateActivationResponse(result.data, ctx);
        if (!validation.ok) {
            const virtuoId = result.data?.id;
            if (virtuoId) {
                await this.cancelActivation(virtuoId).catch((e) => {
                    logger.warn('[Virtuo:API] cancel após mismatch', { virtuoId, detail: e.message });
                });
            }
            return { ok: false, error: validation.error };
        }

        return { ok: true, data: result.data, context: ctx };
    },

    /** @deprecated Use requestActivationForCatalogRow — mantido para scripts. */
    async requestActivationValidated({
        service,
        country,
        countryName,
        catalogRowId,
        server,
        maxPrice,
    }) {
        const VirtuoServiceRepository = require('../repositories/virtuoServiceRepository');
        const row = catalogRowId ? VirtuoServiceRepository.findById(catalogRowId) : null;
        if (row) {
            return this.requestActivationForCatalogRow(row, {
                maxPrice,
                order: {
                    service_code: service,
                    country_id: country,
                    country_name: countryName,
                    virtuo_service_id: catalogRowId,
                    server,
                },
            });
        }
        const { resolveApiCountry } = require('../utils/virtuoCountryResolver');
        const resolved = await resolveApiCountry({
            serviceCode: service,
            countryId: country,
            countryName,
            catalogRowId,
            server: server || VirtuoConfig.defaultServer,
        });
        if (!resolved.ok) {
            return { ok: false, error: resolved.error };
        }
        return this.requestActivation({
            service,
            country: resolved.apiCountryId,
            server,
            maxPrice,
        });
    },

    async getActivationStatus(id) {
        return request('GET', `/activation/${encodeURIComponent(id)}/status`);
    },

    async cancelActivation(id) {
        return request('POST', `/activation/${encodeURIComponent(id)}/cancel`);
    },

    async completeActivation(id) {
        return request('POST', `/activation/${encodeURIComponent(id)}/complete`);
    },
};

module.exports = VirtuoApiClient;
