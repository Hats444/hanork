'use strict';

const { getPrisma } = require('./smmPrismaAccess');

const SmmServiceRepository = {
    upsert(row) {
        return getPrisma().smmService.upsert(row);
    },
    findById(id) {
        return getPrisma().smmService.findById(id);
    },
    findByProviderId(provider, providerServiceId) {
        return getPrisma().smmService.findByProviderId(provider, providerServiceId);
    },
    countActive() {
        return getPrisma().smmService.countActive();
    },
    countAll() {
        return getPrisma().smmService.countAll();
    },
    listPlatforms() {
        return getPrisma().smmService.listPlatforms();
    },
    listSubcategories(platform) {
        return getPrisma().smmService.listSubcategories(platform);
    },
    listByPlatformSub(platform, subcategory, limit, offset) {
        return getPrisma().smmService.listByPlatformSub(platform, subcategory, limit, offset);
    },
    listAllByPlatformSub(platform, subcategory) {
        return getPrisma().smmService.listAllByPlatformSub(platform, subcategory);
    },
    search(query, limit) {
        return getPrisma().smmService.search(query, limit);
    },
    deactivateMissing(provider, activeIds) {
        return getPrisma().smmService.deactivateMissing(provider, activeIds);
    },
    listByFamily(serviceFamily, activeOnly) {
        return getPrisma().smmService.listByFamily(serviceFamily, activeOnly);
    },
    findBestInFamily(serviceFamily) {
        return getPrisma().smmService.findBestInFamily(serviceFamily);
    },
    countFamilies(activeOnly) {
        return getPrisma().smmService.countFamilies(activeOnly);
    },
    refreshFamilyScores() {
        return getPrisma().smmService.refreshFamilyScores();
    },
    getOrderHealthCounts(serviceId, windowDays) {
        return getPrisma().smmService.getOrderHealthCounts(serviceId, windowDays);
    },
    listIdsForHealthRecalc(windowDays) {
        return getPrisma().smmService.listIdsForHealthRecalc(windowDays);
    },
    updateHealth(serviceId, health, deactivate) {
        return getPrisma().smmService.updateHealth(serviceId, health, deactivate);
    },
    countByHealth(activeOnly) {
        return getPrisma().smmService.countByHealth(activeOnly);
    },
};

module.exports = SmmServiceRepository;
