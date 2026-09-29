'use strict';

const logger = require('../../../config/logger');
const SmmConfig = require('../smmConfig');
const { startSmmOrderMonitorScheduler } = require('../../../jobs/schedulers/smmOrderMonitorScheduler');
const { startSmmCatalogSyncScheduler } = require('../../../jobs/schedulers/smmCatalogSyncScheduler');

/**
 * Inicia schedulers SMM (monitor 10min + sync 6h). Só executa com SMM_ENABLED=1.
 * @param {{ bot, log }} deps
 * @returns {NodeJS.Timeout[]}
 */
function startSmmSchedulers(deps = {}) {
    if (!SmmConfig.isEnabled()) {
        (deps.log || logger).info('[SMM] Schedulers desligados (SMM_ENABLED=0)');
        return [];
    }

    const log = deps.log || logger;
    const handles = [];

    handles.push(startSmmOrderMonitorScheduler({ bot: deps.bot, log }));
    handles.push(startSmmCatalogSyncScheduler({ log }));

    const { startSmmRefillMonitorScheduler } = require('../../../jobs/schedulers/smmRefillMonitorScheduler');
    handles.push(startSmmRefillMonitorScheduler({ bot: deps.bot, log }));

    const { startSmmServiceHealthScheduler } = require('../../../jobs/schedulers/smmServiceHealthScheduler');
    handles.push(startSmmServiceHealthScheduler({ log }));

    const { startSmmProviderBalanceScheduler } = require('../../../jobs/schedulers/smmProviderBalanceScheduler');
    handles.push(startSmmProviderBalanceScheduler({ bot: deps.bot, log }));

    log.info('[SMM] Schedulers ativos (order monitor + catalog sync + refill + service health + balance)');
    return handles;
}

module.exports = { startSmmSchedulers };
