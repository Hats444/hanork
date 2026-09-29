'use strict';

const logger = require('../../../config/logger');
const { isVirtuoEnabled } = require('../virtuoEnabled');
const VirtuoConfig = require('../virtuoConfig');
const { runSyncCatalogJob } = require('../jobs/syncCatalogJob');
const { seedBlocksFromFailedOrders, reconcileCatalogBatch } = require('../services/virtuoStockService');

let bootstrapped = false;

function registerVirtuoBoot(_bot, deps = {}) {
    if (bootstrapped) return;
    bootstrapped = true;

    if (!isVirtuoEnabled()) {
        logger.info('[Virtuo] Módulo desligado (sem VIRTUO_ENABLED/API key e sem catálogo em cache)');
        return;
    }

    logger.info('[Virtuo] Módulo ativo', {
        margin: VirtuoConfig.marginPercent,
        publicAccess: VirtuoConfig.publicAccess,
        apiConfigured: !!VirtuoConfig.apiKey,
    });

    if (VirtuoConfig.apiKey) {
        seedBlocksFromFailedOrders().catch(() => {});
        runSyncCatalogJob().catch((e) => {
            (deps.logger || logger).warn('[Virtuo] sync boot async erro', { detail: e.message });
        });
        (async () => {
            for (let i = 0; i < 4; i++) {
                try {
                    const r = await reconcileCatalogBatch(25);
                    (deps.logger || logger).info('[Virtuo] stock reconcile boot batch', {
                        batch: i + 1,
                        ...r,
                    });
                    if (r.cycleComplete) break;
                } catch (e) {
                    (deps.logger || logger).warn('[Virtuo] stock reconcile boot batch erro', { detail: e.message });
                    break;
                }
            }
        })().catch(() => {});
    }
}

module.exports = { registerVirtuoBoot };
