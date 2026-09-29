'use strict';

/**
 * Resolve parâmetros de POST /v1/activation/request a partir da linha do catálogo.
 * Fonte da verdade: virtuo_services.service_code + country_id validados em GET /v1/prices?service=
 */

const logger = require('../../../config/logger');
const { featuredByCode } = require('../constants/featuredServices');
const { resolveApiCountry, normName } = require('./virtuoCountryResolver');

function normServiceCode(code) {
    return String(code || '').trim().toLowerCase();
}

function assertKnownService(serviceCode) {
    const code = normServiceCode(serviceCode);
    if (!code) return { ok: false, error: { code: 'INVALID_SERVICE', message: 'Código de serviço vazio' } };
    const featured = featuredByCode(code);
    if (!featured) {
        logger.warn('[Virtuo:activation] serviço fora da lista featured', { serviceCode: code });
    }
    return { ok: true, serviceCode: code, featured };
}

/** Valida linha do catálogo + pedido opcional; retorna service/country para a API. */
async function resolveForActivation(catalogRow, order = null) {
    if (!catalogRow?.id) {
        return { ok: false, error: { code: 'NO_CATALOG_ROW', message: 'Linha do catálogo ausente' } };
    }

    const svcCheck = assertKnownService(catalogRow.service_code);
    if (!svcCheck.ok) return svcCheck;
    const apiServiceCode = svcCheck.serviceCode;

    if (order?.service_code && normServiceCode(order.service_code) !== apiServiceCode) {
        logger.error('[Virtuo:activation] service_code divergente pedido vs catálogo', {
            orderId: order.id,
            orderService: order.service_code,
            catalogService: apiServiceCode,
            catalogRowId: catalogRow.id,
        });
        return {
            ok: false,
            error: {
                code: 'SERVICE_MISMATCH',
                message: `Pedido (${order.service_code}) não corresponde ao catálogo (${apiServiceCode})`,
            },
        };
    }

    if (order?.virtuo_service_id && Number(order.virtuo_service_id) !== Number(catalogRow.id)) {
        return {
            ok: false,
            error: { code: 'CATALOG_ROW_MISMATCH', message: 'virtuo_service_id não bate com catálogo' },
        };
    }

    const country = await resolveApiCountry({
        serviceCode: apiServiceCode,
        countryName: catalogRow.country_name,
        countryId: catalogRow.country_id,
        catalogRowId: catalogRow.id,
        server: catalogRow.server || order?.server || 1,
    });
    if (!country.ok) return country;

    const serviceName = catalogRow.service_name || svcCheck.featured?.name || apiServiceCode.toUpperCase();

    return {
        ok: true,
        catalogRowId: catalogRow.id,
        apiServiceCode,
        apiServiceName: serviceName,
        apiCountryId: country.apiCountryId,
        apiCountryName: country.apiCountryName,
        price: country.price,
        available: country.available,
        server: Number(catalogRow.server || order?.server) || 1,
    };
}

function validateActivationResponse(data, expected) {
    if (!data || !expected) return { ok: true };
    const gotService = normServiceCode(data.service?.id || data.service?.code || data.service);
    const gotCountry = Number(data.country?.id ?? data.country);
    const issues = [];

    if (gotService && gotService !== expected.apiServiceCode) {
        issues.push(`service: esperado ${expected.apiServiceCode}, recebido ${gotService}`);
    }
    if (Number.isFinite(gotCountry) && gotCountry !== expected.apiCountryId) {
        issues.push(`country: esperado ${expected.apiCountryId}, recebido ${gotCountry}`);
    }

    if (!issues.length) return { ok: true };

    logger.error('[Virtuo:activation] resposta da API divergente', {
        issues,
        expected,
        gotService: data.service,
        gotCountry: data.country,
        activationId: data.id,
    });
    return {
        ok: false,
        error: {
            code: 'ACTIVATION_RESPONSE_MISMATCH',
            message: issues.join('; '),
        },
    };
}

module.exports = {
    normServiceCode,
    assertKnownService,
    resolveForActivation,
    validateActivationResponse,
    normName,
};
