'use strict';

/**
 * B3 M5 — centraliza schedulers (move-only de bot.js).
 */
function registerEarlySchedulers(deps) {
    const {
        commandLimiter,
        logger,
        prisma,
        bot,
        Markup,
        dbRaw,
        CONFIG,
        bannedUsers,
        broadcastMode,
        addProductMode,
        editProductMode,
        productWizard,
        adminMsgTarget,
        campanhaEmailMode,
        giveawayMode,
        supportMode,
        activeChats,
        cuponsAplicados,
        affSaldoAplicado,
        comprasPendentes,
        lastMenuMsg,
        abandonedCartNotified,
    } = deps;

    const { startCommandLimiterCleanupScheduler } = require('./schedulers/rateLimitCleanupScheduler');
    startCommandLimiterCleanupScheduler({ commandLimiter, log: logger });

    const { startCartCleanupScheduler } = require('./schedulers/cartCleanupScheduler');
    const { startPendingPurchaseCleanupScheduler } = require('./schedulers/pendingPurchaseCleanupScheduler');
    const { startAbandonedCartScheduler } = require('./schedulers/abandonedCartScheduler');
    const { startPixExpiredNotificationScheduler } = require('./schedulers/pixExpiredNotificationScheduler');
    const { startPixPendingReminderScheduler } = require('./schedulers/pixPendingReminderScheduler');
    const { startWebhookDedupCleanupScheduler } = require('./schedulers/webhookDedupCleanupScheduler');

    startCartCleanupScheduler(prisma, logger);
    startPendingPurchaseCleanupScheduler(prisma, logger);
    startWebhookDedupCleanupScheduler(logger);
    startAbandonedCartScheduler({ bot, prisma, Markup, dbRaw, log: logger });
    startPixExpiredNotificationScheduler({ bot, prisma, Markup, log: logger });
    startPixPendingReminderScheduler({ bot, prisma, Markup, log: logger });

    const { startSessionStateSweepScheduler } = require('./schedulers/sessionStateSweepScheduler');
    const { startPostSaleFollowUpScheduler } = require('./schedulers/postSaleFollowUpScheduler');
    const { startFlashSaleExpiryScheduler } = require('./schedulers/flashSaleExpiryScheduler');

    startSessionStateSweepScheduler({
        prisma,
        log: logger,
        getNativeMaps: () => ({
            broadcastMode,
            addProductMode,
            editProductMode,
            productWizard,
            adminMsgTarget,
        }),
        getRedisWrapped: () => ({
            campanhaEmailMode,
            giveawayMode,
            supportMode,
            activeChats,
            cuponsAplicados,
            affSaldoAplicado,
            comprasPendentes,
            lastMenuMsg,
            abandonedCartNotified,
        }),
    });
    startPostSaleFollowUpScheduler({
        bot,
        dbRaw,
        Markup,
        config: CONFIG,
        bannedUsers,
        log: logger,
    });
    startFlashSaleExpiryScheduler({ bot, prisma, config: CONFIG, log: logger });

    const { startSalesRefDailyPromoScheduler } = require('./schedulers/salesRefDailyPromoScheduler');
    startSalesRefDailyPromoScheduler({ bot, dbRaw, config: CONFIG, log: logger });
}

function registerPostBootSchedulers(deps) {
    const {
        bot,
        prisma,
        dbRaw,
        logger,
        state,
        carrinhos,
        comprasPendentes,
        bannedUsers,
        CustomerSubscriptionService,
        QueueService,
        CONFIG,
    } = deps;

    const { startStatePersistenceScheduler } = require('./schedulers/statePersistenceScheduler');
    const { startSubscriptionMaintenanceScheduler } = require('./schedulers/subscriptionMaintenanceScheduler');
    const { startDailyReportScheduler } = require('./schedulers/dailyReportScheduler');

    startStatePersistenceScheduler({
        state,
        carrinhos,
        comprasPendentes,
        bannedUsers,
        log: logger,
    });
    startSubscriptionMaintenanceScheduler({
        bot,
        prisma,
        dbRaw,
        CustomerSubscriptionService,
        log: logger,
    });
    startDailyReportScheduler({
        QueueService,
        adminIds: CONFIG.ID_DONO,
        log: logger,
    });

    const { startTelegramProfileSyncScheduler } = require('./schedulers/telegramProfileSyncScheduler');
    startTelegramProfileSyncScheduler({ bot, log: logger });

    const { startOpsHealthAlertScheduler } = require('./schedulers/opsHealthAlertScheduler');
    startOpsHealthAlertScheduler({ QueueService, log: logger });

    try {
        const { startSmmSchedulers } = require('../modules/smm/hooks/registerSmmSchedulers');
        startSmmSchedulers({ bot, log: logger });
    } catch (e) {
        logger.warn('[SMM] Schedulers skip', { detail: e.message });
    }

    try {
        const { startVirtuoSchedulers } = require('../modules/virtuo/hooks/registerVirtuoSchedulers');
        const adminIds = CONFIG?.ID_DONO || [];
        startVirtuoSchedulers({ bot, log: logger, adminIds });
    } catch (e) {
        logger.warn('[Virtuo] Schedulers skip', { detail: e.message });
    }
}

module.exports = { registerEarlySchedulers, registerPostBootSchedulers };
