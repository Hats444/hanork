'use strict';

const { getPrisma } = require('./smmPrismaAccess');

const SmmOrderEventsRepository = {
    record(smmOrderId, eventType, detail) {
        return getPrisma().smmOrderEvent.record(smmOrderId, eventType, detail);
    },
    listByOrder(smmOrderId, limit) {
        return getPrisma().smmOrderEvent.listByOrder(smmOrderId, limit);
    },
};

module.exports = SmmOrderEventsRepository;
