'use strict';

const SmmConfig = require('./smmConfig');
const { isSmmEnabled } = require('./smmEnabled');

module.exports = {
    isSmmEnabled,
    SmmConfig,
    registerSmmBoot: require('./hooks/registerSmmBoot').registerSmmBoot,
    startSmmSchedulers: require('./hooks/registerSmmSchedulers').startSmmSchedulers,
    CatalogService: require('./services/catalogService'),
    SyncService: require('./services/syncService'),
    ClassificationService: require('./services/classificationService'),
    PricingService: require('./services/pricingService'),
    OrderService: require('./services/orderService'),
    StatusService: require('./services/statusService'),
    RefillService: require('./services/refillService'),
    CancelService: require('./services/cancelService'),
    CacheService: require('./services/cacheService'),
    ServiceRepository: require('./repositories/smmServiceRepository'),
    OrderRepository: require('./repositories/smmOrderRepository'),
    getProvider: require('./providers/providerRegistry').getProvider,
    ProviderManager: require('./providers/ProviderManager'),
    registerSmmCommands: require('./commands/registerSmmCommands').registerSmmCommands,
};
