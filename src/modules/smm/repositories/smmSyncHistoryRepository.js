'use strict';

const { getPrisma } = require('./smmPrismaAccess');

const SmmSyncHistoryRepository = {
    start(syncType) {
        return getPrisma().smmSyncHistory.start(syncType);
    },
    finish(id, stats) {
        return getPrisma().smmSyncHistory.finish(id, stats);
    },
    last() {
        return getPrisma().smmSyncHistory.last();
    },
};

module.exports = SmmSyncHistoryRepository;
