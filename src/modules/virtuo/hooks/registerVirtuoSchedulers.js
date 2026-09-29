'use strict';

const logger = require('../../../config/logger');
const VirtuoConfig = require('../virtuoConfig');
const { isVirtuoEnabled } = require('../virtuoEnabled');
const { runActivationMonitorJob } = require('../jobs/activationMonitorJob');
const { runSyncCatalogJob } = require('../jobs/syncCatalogJob');
const { reconcileCatalogBatch } = require('../services/virtuoStockService');
const { runBalanceMonitorJob } = require('../jobs/balanceMonitorJob');
const adminOpsDigest = require('../../../services/adminOpsDigest');

function startVirtuoSchedulers(deps = {}) {
    if (!isVirtuoEnabled()) {
        (deps.log || logger).info('[Virtuo] Schedulers desligados');
        return [];
    }

    const log = deps.log || logger;
    const handles = [];
    const bot = deps.bot || global.botInstance;
    const adminIds = deps.adminIds || [];

    handles.push(
        setInterval(async () => {
            try {
                const r = await runActivationMonitorJob(bot);
                if (r.checked > 0) log.info('[Virtuo:CRON] Activation monitor', r);
            } catch (e) {
                log.warn('[Virtuo:CRON] monitor erro', { detail: e.message });
            }
        }, VirtuoConfig.pollIntervalMs)
    );

    handles.push(
        setInterval(async () => {
            try {
                await runSyncCatalogJob();
            } catch (e) {
                log.warn('[Virtuo:CRON] sync erro', { detail: e.message });
            }
        }, VirtuoConfig.syncIntervalMs)
    );

    if (VirtuoConfig.balanceMonitorEnabled) {
        handles.push(
            setInterval(async () => {
                try {
                    await runBalanceMonitorJob(bot);
                } catch (e) {
                    log.warn('[Virtuo:CRON] balance erro', { detail: e.message });
                }
            }, VirtuoConfig.balanceMonitorMs)
        );
    }

    handles.push(
        setInterval(async () => {
            try {
                const r = await reconcileCatalogBatch();
                if (r.activated > 0 || r.deactivated > 0) {
                    log.info('[Virtuo:CRON] stock reconcile', r);
                }
                adminOpsDigest.record('stock_reconcile', r);
            } catch (e) {
                log.warn('[Virtuo:CRON] stock probe erro', { detail: e.message });
            }
        }, VirtuoConfig.stockRecheckIntervalMs)
    );

    log.info('[Virtuo] Schedulers ativos (poll + sync + balance + stock)');
    return handles;
}

module.exports = { startVirtuoSchedulers };
