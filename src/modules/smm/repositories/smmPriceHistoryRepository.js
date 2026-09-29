'use strict';

const { getPrisma } = require('./smmPrismaAccess');

const SmmPriceHistoryRepository = {
    record(serviceId, oldPrice, newPrice) {
        return getPrisma().smmPriceHistory.record(serviceId, oldPrice, newPrice);
    },
};

module.exports = SmmPriceHistoryRepository;
