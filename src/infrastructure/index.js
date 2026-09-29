/**
 * Infrastructure Index - Entry point para nova arquitetura
 * 
 * Facilita imports centralizados e documenta a API pública
 * da infraestrutura refatorada.
 * 
 * Uso:
 *   const { eventBus, stateManager, tenantContext } = require('./infrastructure');
 */

const eventBusModule = require('./eventBus');
const eventBus = eventBusModule;
const DomainEvents = eventBusModule.DomainEvents;
const stateManager = require('./DistributedStateManager');
const tenantContext = require('./TenantContext');
const BaseRepository = require('./BaseRepository');
const correlationContext = require('./CorrelationContext');

module.exports = {
    // Core infrastructure
    eventBus,
    stateManager,
    tenantContext,
    BaseRepository,
    correlationContext,

    // Domain events
    DomainEvents,

    // Migration helpers
    withTenant: tenantContext.runAs.bind(tenantContext),
    getCurrentTenant: tenantContext.getCurrent.bind(tenantContext),

    // Lock helpers
    withLock: (key, ttl, fn) => {
        const acquired = stateManager.acquireLock(key, ttl);
        if (!acquired) throw new Error(`Lock not acquired: ${key}`);
        try {
            return fn();
        } finally {
            stateManager.releaseLock(key);
        }
    },

    // Correlation ID helpers
    withCorrelationId: correlationContext.runWithId.bind(correlationContext),
    getCorrelationId: correlationContext.getId.bind(correlationContext),
    getCorrelationMeta: correlationContext.getMetadata.bind(correlationContext)
};

// Migration Guide:
//
// PASSO 1: Substituir variáveis globais
// ANTES:
//   let broadcastRunning = false;
//   if (broadcastRunning) return;
//   broadcastRunning = true;
//   ...
//   broadcastRunning = false;
//
// DEPOIS:
//   const { adapter } = require('./infrastructure');
//   const acquired = await adapter.getStateManager()
//     .acquireLock(`broadcast:${tenantId}`, 300000);
//   if (!acquired) return;
//   try { ... } finally { adapter.getStateManager().releaseLock(...); }
//
// PASSO 2: Usar EventBus para desacoplar
// ANTES:
//   orderService.create() → cashbackService.add() → notificationService.send()
//
// DEPOIS:
//   const { eventBus, DomainEvents } = require('./infrastructure');
//   await orderService.create(data);
//   await eventBus.emit(DomainEvents.ORDER_PAID, { orderId, userId, tenantId });
//   // Cashback, Notification handlers reagem ao evento independentemente
//
// PASSO 3: Repository Pattern
// ANTES:
//   const orders = db.prepare('SELECT * FROM orders WHERE user_id = ?').all(userId);
//
// DEPOIS:
//   const { BaseRepository } = require('./infrastructure');
//   class OrderRepository extends BaseRepository {
//     constructor() { super('orders'); }
//   }
//   const orderRepo = new OrderRepository();
//   const orders = await orderRepo.find({ user_id: userId });
//   // Automaticamente inclui: AND tenant_id = ?
//
// PASSO 4: Tenant Context
// ANTES:
//   // Código não sabe de qual tenant está executando
//
// DEPOIS:
//   const { tenantContext } = require('./infrastructure');
//   const tenant = tenantContext.getCurrent();
//   console.log(`Executing for tenant: ${tenant.id}`);
//   // Ou usar middleware para definir contexto automaticamente
