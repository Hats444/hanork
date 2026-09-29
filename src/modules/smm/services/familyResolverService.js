'use strict';

const SmmServiceRepository = require('../repositories/smmServiceRepository');
const SmmConfig = require('../smmConfig');
const { isFulfillHealth } = require('../constants/serviceHealthStatuses');
const { normalizeServiceType } = require('../constants/serviceTypes');

function isFamilyFailoverEligible(service) {
    return normalizeServiceType(service?.service_type) === 'Default';
}

function fitsQuantity(service, quantity) {
    const qty = Number(quantity);
    const min = Number(service?.min_quantity) || 1;
    const max = Number(service?.max_quantity) || Number.MAX_SAFE_INTEGER;
    return Number.isFinite(qty) && qty >= min && qty <= max;
}

/**
 * Candidatos para fulfill: serviço pedido primeiro, depois família por score (onda B).
 * @returns {object[]} serviços ativos, qty válida, sem duplicar id
 */
function resolveFulfillCandidates(orderedService, quantity) {
    if (!orderedService) return [];

    if (!isFamilyFailoverEligible(orderedService)) {
        if (isFulfillHealth(orderedService) && fitsQuantity(orderedService, quantity)) {
            return [orderedService];
        }
        return [];
    }

    const family = orderedService.service_family;
    const pool = family
        ? SmmServiceRepository.listByFamily(family, true)
        : orderedService.active
            ? [orderedService]
            : [];

    const viable = pool.filter((s) => fitsQuantity(s, quantity) && isFulfillHealth(s));
    const seen = new Set();
    const out = [];

    const push = (s) => {
        if (!s || seen.has(s.id) || !isFulfillHealth(s)) return;
        if (!fitsQuantity(s, quantity)) return;
        seen.add(s.id);
        out.push(s);
    };

    if (isFulfillHealth(orderedService)) {
        push(orderedService);
    }

    const rest = viable
        .filter((s) => s.id !== orderedService.id)
        .sort((a, b) => {
            const ds = (Number(b.service_score) || 0) - (Number(a.service_score) || 0);
            if (ds !== 0) return ds;
            return Number(a.cost_price) - Number(b.cost_price);
        });

    for (const s of rest) push(s);

    if (!out.length && isFulfillHealth(orderedService) && fitsQuantity(orderedService, quantity)) {
        return [orderedService];
    }

    return out.slice(0, SmmConfig.failoverMaxCandidates);
}

module.exports = {
    fitsQuantity,
    resolveFulfillCandidates,
};
