'use strict';

const { getPrisma } = require('../../smm/repositories/smmPrismaAccess');

const VirtuoServiceRepository = {
    upsert(row) {
        return getPrisma().virtuoService.upsert(row);
    },
    listActiveByServiceCode(serviceCode) {
        return getPrisma().virtuoService.listActiveByServiceCode(serviceCode);
    },
    countActiveByServiceCode(serviceCode) {
        return getPrisma().virtuoService.countActiveByServiceCode(serviceCode);
    },
    listActiveByServiceCodePage(serviceCode, page, pageSize) {
        return getPrisma().virtuoService.listActiveByServiceCodePage(serviceCode, page, pageSize);
    },
    searchActiveByServiceCodeName(serviceCode, query, limit) {
        return getPrisma().virtuoService.searchActiveByServiceCodeName(serviceCode, query, limit);
    },
    searchActiveGlobal(query, limit) {
        return getPrisma().virtuoService.searchActiveGlobal(query, limit);
    },
    findActiveByCountryNames(serviceCode, names) {
        return getPrisma().virtuoService.findActiveByCountryNames(serviceCode, names);
    },
    listDistinctServiceCodes() {
        return getPrisma().virtuoService.listDistinctServiceCodes();
    },
    findById(id) {
        return getPrisma().virtuoService.findById(id);
    },
    findByComposite(serviceCode, countryId, server = 1) {
        return getPrisma().virtuoService.findByComposite(serviceCode, countryId, server);
    },
    setAvailability(id, available, active) {
        return getPrisma().virtuoService.setAvailability(id, available, active);
    },
    countActive() {
        return getPrisma().virtuoService.countActive();
    },
    deactivateMissing(activeKeys) {
        return getPrisma().virtuoService.deactivateMissing(activeKeys);
    },
    decrementAvailable(id, by = 1) {
        return getPrisma().virtuoService.decrementAvailable(id, by);
    },
    listAfterId(afterId, limit = 25) {
        return getPrisma().virtuoService.listAfterId(afterId, limit);
    },
    countAll() {
        return getPrisma().virtuoService.countAll();
    },
    countSellable() {
        return getPrisma().virtuoService.countSellable();
    },
    patchCountryId(id, countryId, countryName) {
        return getPrisma().virtuoService.patchCountryId(id, countryId, countryName);
    },
};

module.exports = VirtuoServiceRepository;
