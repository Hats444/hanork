'use strict';

const SmmConfig = require('../smmConfig');
const SmmServiceRepository = require('../repositories/smmServiceRepository');
const CacheService = require('./cacheService');
const { computeOrderTotal } = require('./pricingService');
const { pickBestPerFamily } = require('./familyService');
const { isCatalogServiceType } = require('../constants/serviceTypes');

const CatalogService = {
    async getPlatforms() {
        return CacheService.getPlatforms();
    },

    listSubcategories(platform) {
        return SmmServiceRepository.listSubcategories(platform);
    },

    /** Lista comercial: 1 representante por família (V2 onda F). */
    listFamilies(platform, subcategory, page = 0) {
        const all = SmmServiceRepository.listAllByPlatformSub(platform, subcategory);
        const families = pickBestPerFamily(all);
        const size = SmmConfig.catalogPageSize;
        const offset = Math.max(0, page) * size;
        const items = families.slice(offset, offset + size);
        return {
            items,
            page,
            pageSize: size,
            hasMore: offset + size < families.length,
            totalFamilies: families.length,
        };
    },

    listServices(platform, subcategory, page = 0) {
        return this.listFamilies(platform, subcategory, page);
    },

    getService(id) {
        const row = SmmServiceRepository.findById(id);
        if (!row || !row.active) return null;
        if (!isCatalogServiceType(row.service_type)) return null;
        return row;
    },

    getFamilyRepresentative(serviceFamily) {
        if (!serviceFamily) return null;
        return SmmServiceRepository.findBestInFamily(serviceFamily);
    },

    search(query, limit = 20) {
        const raw = SmmServiceRepository.search(query, Math.min(100, limit * 4));
        return pickBestPerFamily(raw).slice(0, limit);
    },

    quote(serviceId, quantity) {
        const svc = this.getService(serviceId);
        if (!svc) return null;
        const qty = Number(quantity);
        if (!Number.isFinite(qty) || qty < svc.min_quantity || qty > svc.max_quantity) {
            return { error: 'quantity_out_of_range', min: svc.min_quantity, max: svc.max_quantity };
        }
        const saleTotal = computeOrderTotal(svc.sale_price, qty, svc.service_type);
        return {
            service: svc,
            quantity: qty,
            sale_total: saleTotal,
            sale_price_per_1000: svc.sale_price,
            cost_price_per_1000: svc.cost_price,
        };
    },

    async stats() {
        return CacheService.getStats();
    },
};

module.exports = CatalogService;
