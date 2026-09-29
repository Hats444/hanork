'use strict';

const VirtuoCatalogService = require('../services/catalogService');

async function runSyncCatalogJob() {
    return VirtuoCatalogService.syncCatalogFromApi();
}

module.exports = { runSyncCatalogJob };
