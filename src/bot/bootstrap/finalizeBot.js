'use strict';

const { registerGracefulShutdown } = require('../../app/gracefulShutdown');
const { startBot: runStartBot } = require('../../app/startBot');
const { registerPaymentActions } = require('../../telegram/callbacks/payment/registerPaymentActions');
const { registerOrderPaidAnalytics } = require('../../jobs/eventHandlers/orderPaidAnalytics');
const { registerConversionEventHandlers } = require('../../jobs/eventHandlers/conversionEventHandlers');
const { registerSalesReferenceChannel } = require('../../jobs/eventHandlers/salesReferenceChannel');
const { registerAdminSaleNotify } = require('../../jobs/eventHandlers/adminSaleNotify');
const { registerCallbacks } = require('./registerCallbacks');

/**
 * B3 — registro tardio: tenant SaaS, pagamento legado, callbacks, shutdown, boot.
 * @param {object} deps
 */
function finalizeBotBootstrap(deps) {
    const {
        bot,
        stateManager,
        isAdmin,
        eventBus,
        logger,
        registry,
        shutdown,
        payment,
        callbacks,
        adminIds,
        analytics,
        boot,
    } = deps;

    const {
        setOnboardingStateManager,
        registerOnboardingHandlers,
    } = require('../../modules/tenant/onboardingHandler');
    setOnboardingStateManager(stateManager);
    registerOnboardingHandlers(bot);

    const { registerSaasHandlers } = require('../../modules/tenant/saasHandlers');
    registerSaasHandlers(bot, { stateManager, isAdmin });

    registerGracefulShutdown(shutdown);

    registerPaymentActions(bot, payment);

    registerOrderPaidAnalytics(eventBus, analytics);

    registerConversionEventHandlers(eventBus, { logger });

    registerSalesReferenceChannel(eventBus, {
        bot: boot.bot,
        dbRaw: boot.dbRaw,
        logger,
        groupService: boot.groupService,
    });

    registerAdminSaleNotify(eventBus, {
        dbRaw: boot.dbRaw,
        logger,
    });

    try {
        const { registerSmmBoot } = require('../../modules/smm/hooks/registerSmmBoot');
        registerSmmBoot(bot, { logger });
    } catch (smmErr) {
        logger.warn('[SMM] Boot skip', { detail: smmErr.message });
    }

    try {
        const { registerVirtuoBoot } = require('../../modules/virtuo/hooks/registerVirtuoBoot');
        registerVirtuoBoot(bot, { logger });
    } catch (virtuoErr) {
        logger.warn('[Virtuo] Boot skip', { detail: virtuoErr.message });
    }

    try {
        const { registerWaDivulgacaoBoot } = require('../../modules/wa-divulgacao/hooks/registerWaDivulgacaoBoot');
        registerWaDivulgacaoBoot(bot, { logger });
    } catch (waDivErr) {
        logger.warn('[WaDivulgacao] Boot skip', { detail: waDivErr.message });
    }

    try {
        registerCallbacks(bot, callbacks, adminIds);
        logger.success('[LOADER] Callbacks registrados', {
            category: 'LOADER',
            module: 'CALLBACK',
            registered: registry.stats.registered,
        });
    } catch (initError) {
        logger.error('[Bot] Callback init FAILED', { error: initError.message, stack: initError.stack });
        process.exit(1);
    }

    runStartBot(boot);
}

module.exports = { finalizeBotBootstrap };
