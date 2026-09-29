'use strict';

const { syncCatalog } = require('../services/syncService');

async function runSyncServicesJob(options = {}) {
    return syncCatalog(options);
}

module.exports = { runSyncServicesJob };
